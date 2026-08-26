import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared E2E helpers.
 *
 * Assertions here read the persisted database directly via `page.evaluate`, not
 * only the rendered UI. Several rules this app must not break — balanced
 * double-entry postings, never-reused serials, append-only audit entries — have
 * no UI yet (modules 4 and 8 are unbuilt), and checking them against the real
 * store is the only way to catch a regression before those pages ship.
 */

export const DB_NAME = "vrikshafx";

export interface SeededProfile {
  legalName: string;
  address: string;
  gstin: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankSwift: string;
}

export const COMPLETE_PROFILE: SeededProfile = {
  legalName: "Rahul Goel HUF",
  address: "12 Nehru Place\nNew Delhi 110019\nIndia",
  gstin: "07AAAAA0000A1Z5",
  bankName: "HDFC Bank",
  bankAccountNumber: "50100123456789",
  bankIfsc: "HDFC0000123",
  bankSwift: "HDFCINBBXXX",
};

/**
 * Reads a whole Dexie table out of the live page.
 *
 * Checks the database exists before opening it: a bare `indexedDB.open(name)`
 * CREATES an empty database at version 1 if none is there. Dexie would then see
 * a pre-existing database, run its upgrade path instead of `populate`, and never
 * seed the currencies — a probe that silently breaks the thing it is measuring.
 */
export async function readTable<T = unknown>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(
    async ({ dbName, tableName }) => {
      const existing = await indexedDB.databases();
      if (!existing.some((entry) => entry.name === dbName)) return [] as T[];

      return new Promise<T[]>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(tableName)) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction(tableName, "readonly");
          const all = tx.objectStore(tableName).getAll();
          all.onsuccess = () => {
            resolve(all.result as T[]);
            db.close();
          };
          all.onerror = () => {
            reject(all.error);
            db.close();
          };
        };
      });
    },
    { dbName: DB_NAME, tableName: table }
  );
}

export interface LedgerEntryShape {
  id: string;
  account: string;
  debit: number;
  credit: number;
  sourceType: string;
  sourceId: string;
  date: string;
}

export interface AuditEntryShape {
  id: string;
  actionType: string;
  entityType: string;
  entityId: string;
  isManualOverride: boolean;
  summary: string;
  timestamp: string;
}

export interface InvoiceShape {
  id: string;
  serialNumber: string;
  sequence: number;
  financialYear: string;
  status: string;
  currency: string;
  invoiceDateFxRate: number;
  manualStatusOverride: boolean;
  lineItems: { id: string; description: string; quantity: number; unitPrice: number }[];
}

/**
 * Asserts the ledger balances overall. Every posting helper writes a balanced
 * set, so any imbalance across the whole table means a rule was bypassed.
 */
export function expectLedgerBalanced(entries: LedgerEntryShape[]): void {
  const debits = entries.reduce((sum, e) => sum + e.debit, 0);
  const credits = entries.reduce((sum, e) => sum + e.credit, 0);
  expect(Math.abs(debits - credits)).toBeLessThan(0.01);
}

/** Net movement on one account: debits minus credits. */
export function accountBalance(entries: LedgerEntryShape[], account: string): number {
  return Number(
    entries
      .filter((e) => e.account === account)
      .reduce((sum, e) => sum + e.debit - e.credit, 0)
      .toFixed(2)
  );
}

/** Fills the entity profile through the Settings UI, which is what gates PDF generation. */
export async function completeEntityProfile(
  page: Page,
  overrides: Partial<SeededProfile> = {}
): Promise<void> {
  const profile = { ...COMPLETE_PROFILE, ...overrides };

  await page.goto("/settings");
  // Card titles render as plain divs in this shadcn style, so match on text —
  // exactly, since the page description repeats the phrase.
  await expect(page.getByText("Entity particulars", { exact: true })).toBeVisible();

  await page.getByLabel("Legal name").fill(profile.legalName);
  await page.getByLabel("Address").fill(profile.address);
  await page.getByLabel("GSTIN").fill(profile.gstin);
  await page.getByLabel("Bank name").fill(profile.bankName);
  await page.getByLabel("Account number").fill(profile.bankAccountNumber);
  await page.getByLabel("IFSC code").fill(profile.bankIfsc);
  await page.getByLabel("SWIFT / BIC code").fill(profile.bankSwift);

  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Entity profile saved.")).toBeVisible();
}

export interface ClientSeed {
  name: string;
  country: string;
  currency?: string;
  billingAddress?: string;
  taxId?: string;
  primaryContact?: string;
}

/** Adds a client through the UI. Kept UI-driven so the form itself stays covered. */
export async function addClient(page: Page, client: ClientSeed): Promise<void> {
  await page.goto("/clients");
  await openPrimaryAction(page, "New client");

  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Client name").fill(client.name);
  await sheet.getByLabel("Country").fill(client.country);

  if (client.currency) {
    await sheet.getByLabel("Default currency").click();
    await page.getByRole("option", { name: new RegExp(`^${client.currency}\\b`) }).click();
  }
  if (client.primaryContact) await sheet.getByLabel("Primary contact").fill(client.primaryContact);
  if (client.taxId) await sheet.getByLabel("Tax ID").fill(client.taxId);
  if (client.billingAddress) await sheet.getByLabel("Billing address").fill(client.billingAddress);

  await sheet.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByText(`${client.name} added.`)).toBeVisible();
}

export interface InvoiceSeed {
  clientName: string;
  fxRate: string;
  description?: string;
  quantity?: string;
  unitPrice?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency?: string;
  /** Save as a draft instead of issuing straight away. */
  asDraft?: boolean;
}

/**
 * Fills and submits the invoice sheet, returning the serial it was actually
 * issued as.
 *
 * The serial is read back from the store rather than from the sheet's "Will be
 * issued as" preview: the financial year comes from the invoice date, so a
 * back-dated invoice lands in a different year — and a different sequence — than
 * whatever the preview showed before that date was typed in.
 */
export async function addInvoice(page: Page, invoice: InvoiceSeed): Promise<string> {
  await page.goto("/invoices");
  await openPrimaryAction(page, "New invoice");

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/Will be issued as/)).toBeVisible();

  const before = new Set((await readTable<InvoiceShape>(page, "invoices")).map((i) => i.id));

  await sheet.getByLabel("Client").click();
  await page.getByRole("option", { name: new RegExp(invoice.clientName) }).click();

  if (invoice.currency) {
    await sheet.getByLabel("Currency").click();
    await page.getByRole("option", { name: new RegExp(`^${invoice.currency}\\b`) }).click();
  }
  if (invoice.invoiceDate) await sheet.getByLabel("Invoice date", { exact: true }).fill(invoice.invoiceDate);
  if (invoice.dueDate) await sheet.getByLabel("Due date", { exact: true }).fill(invoice.dueDate);

  await sheet.getByLabel(/Exchange rate on invoice date/).fill(invoice.fxRate);
  await sheet.getByLabel("Description").fill(invoice.description ?? "Consulting services");
  await sheet.getByLabel("Qty").fill(invoice.quantity ?? "1");
  await sheet.getByLabel(/^Rate \(/).fill(invoice.unitPrice ?? "1000");

  await sheet
    .getByRole("button", { name: invoice.asDraft ? "Save as draft" : "Save & issue" })
    .click();
  await expect(page.getByText(invoice.asDraft ? /saved as draft\.$/ : /issued\.$/)).toBeVisible();

  const created = (await readTable<InvoiceShape>(page, "invoices")).find((i) => !before.has(i.id));
  if (!created) throw new Error("Invoice was reported saved but is not in the database.");
  return created.serialNumber;
}

/** Tailwind's `md` breakpoint — where the header button gives way to the FAB. */
const MD_BREAKPOINT = 768;

/**
 * Clicks a page's primary action.
 *
 * Below `md` the header button is hidden and the action lives on a floating
 * button instead. The choice is made from the viewport width rather than from
 * `isVisible()`, which does not auto-wait: on a slow first paint it would report
 * false for a button that is merely not rendered yet, then fall through to a FAB
 * that will never appear on desktop.
 */
export async function openPrimaryAction(page: Page, label: string): Promise<void> {
  const width = page.viewportSize()?.width ?? MD_BREAKPOINT;

  if (width < MD_BREAKPOINT) {
    await page.getByLabel(label).click();
  } else {
    await page.getByRole("button", { name: label }).first().click();
  }

  await expect(page.getByRole("dialog")).toBeVisible();
}

/**
 * Locates a serial in whichever list layout is on screen.
 *
 * Both layouts are always in the DOM - the desktop table is `hidden md:block`
 * and the mobile cards are `md:hidden` - so an unfiltered match would resolve to
 * the hidden one first and never become clickable.
 */
export function visibleSerial(page: Page, serial: string) {
  return page.getByText(serial, { exact: true }).filter({ visible: true }).first();
}

/** Opens an invoice's detail sheet from the list, on either layout. */
export async function openInvoice(page: Page, serial: string): Promise<void> {
  await page.goto("/invoices");
  await visibleSerial(page, serial).click();
  await expect(page.getByRole("dialog").getByText(serial).first()).toBeVisible();
}

/**
 * Playwright gives every test its own browser context, and IndexedDB is scoped
 * to a context — so each test already starts on an empty database that the app
 * seeds itself. An explicit `deleteDatabase` in an init script would race with
 * Dexie's own open and could wipe the seed it had just written.
 */
export const test = base;

export { expect };
