import zlib from "node:zlib";

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
  /** Rule 46(q). Part of `REQUIRED_PROFILE_FIELDS`, so PDF generation is gated on it. */
  authorisedSignatory: string;
  state: string;
  stateCode: string;
  lutNumber: string;
  pan: string;
  usTaxFormReference: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankSwift: string;
}

export const COMPLETE_PROFILE: SeededProfile = {
  legalName: "Rahul Goel HUF",
  address: "12 Nehru Place\nNew Delhi 110019\nIndia",
  gstin: "07AAAAA0000A1Z5",
  authorisedSignatory: "Rahul Goel",
  state: "Delhi",
  stateCode: "07",
  lutNumber: "AD070422000123X",
  pan: "AAAAA0000A",
  usTaxFormReference: "W-8BEN-E dated 2026-04-01",
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
  await page.getByLabel("PAN").fill(profile.pan);
  await page.getByLabel("LUT number").fill(profile.lutNumber);
  // Rule 46(q): without a signatory `missingProfileFields` gates every PDF, so
  // any spec that reaches the download button needs this filled.
  await page.getByLabel("Authorised signatory").fill(profile.authorisedSignatory);
  await page.getByLabel("State", { exact: true }).fill(profile.state);
  await page.getByLabel("State code").fill(profile.stateCode);
  await page.getByLabel("US withholding certificate").fill(profile.usTaxFormReference);
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
  /** Rule 46(o) — only printed on the PDF where it differs from the billing address. */
  deliveryAddress?: string;
  taxId?: string;
  primaryContact?: string;
  sacCode?: string;
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
  if (client.deliveryAddress) {
    await sheet.getByLabel("Address of delivery").fill(client.deliveryAddress);
  }
  // On the Details tab, not Billing: Rule 46(g) wants the accounting code on
  // an export as well, so it sits outside the domestic-tax block.
  if (client.sacCode) await sheet.getByLabel("SAC code").fill(client.sacCode);

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
 * Switches the line-item editor between date-wise hourly lines and flat amounts.
 *
 * The sheet opens on hourly, and picking a client re-applies whatever that client
 * is billed on, so a spec that wants the flat "Qty / Rate" columns has to ask for
 * them rather than rely on a default that a seeded client can move.
 */
export async function setLineItemMode(page: Page, mode: "hourly" | "fixed"): Promise<void> {
  const sheet = page.getByRole("dialog");
  await sheet
    .getByRole("combobox")
    .filter({ hasText: /Itemised by date|Fixed amounts/ })
    .click();
  await page
    .getByRole("option", { name: mode === "hourly" ? "Itemised by date" : "Fixed amounts" })
    .click();
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
  // Flat amounts, whatever the client is normally billed on: every spec that
  // uses this helper predates hourly itemisation and reads the "Qty / Rate"
  // labels. `phase2-engagements.spec.ts` drives the hourly editor directly.
  await setLineItemMode(page, "fixed");

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
 * Canned answers from the IFSC directory, keyed by code.
 *
 * The settings form looks a branch up as soon as a well-formed IFSC is typed,
 * and `completeEntityProfile` runs in nearly every spec — left unstubbed the
 * suite would hammer a third-party service dozens of times per run and fail
 * whenever it is slow. Anything not listed here answers 404, which is how an
 * unknown code behaves for real.
 */
export const IFSC_DIRECTORY: Record<string, Record<string, string>> = {
  HDFC0000123: {
    IFSC: "HDFC0000123",
    BANK: "HDFC Bank",
    BRANCH: "NEHRU PLACE",
    ADDRESS: "12 NEHRU PLACE, NEW DELHI 110019",
    CITY: "NEW DELHI",
    CENTRE: "NEW DELHI",
    STATE: "DELHI",
    // Most branches publish no SWIFT code — the form has to cope with that
    // rather than assume the lookup completes the wire block on its own.
    SWIFT: "",
  },
  ICIC0001234: {
    IFSC: "ICIC0001234",
    BANK: "ICICI Bank",
    BRANCH: "BANDRA KURLA COMPLEX",
    ADDRESS: "BKC, MUMBAI 400051",
    CITY: "MUMBAI",
    CENTRE: "MUMBAI",
    STATE: "MAHARASHTRA",
    SWIFT: "ICICINBBCTS",
  },
};

export const IFSC_DIRECTORY_URL = /^https:\/\/ifsc\.razorpay\.com\//;

/**
 * Playwright gives every test its own browser context, and IndexedDB is scoped
 * to a context — so each test already starts on an empty database that the app
 * seeds itself. An explicit `deleteDatabase` in an init script would race with
 * Dexie's own open and could wipe the seed it had just written.
 *
 * The one automatic fixture stubs the IFSC directory. It is registered first, so
 * a test that wants a different answer — an outage, a 404 — can call
 * `page.route` again and have its handler take precedence.
 */
export const test = base.extend<{ ifscDirectory: void }>({
  ifscDirectory: [
    async ({ page }, use) => {
      await page.route(IFSC_DIRECTORY_URL, async (route) => {
        const code = new URL(route.request().url()).pathname.replace(/^\//, "").toUpperCase();
        const branch = IFSC_DIRECTORY[code];
        if (!branch) {
          await route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(branch),
        });
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Pulls readable text out of a generated PDF.
 *
 * @react-pdf writes one `TJ` per laid-out line, with the glyphs as hex strings
 * split around kerning adjustments — e.g. `[<54> 120 <41> 0 <20494e56>] TJ` is
 * one line reading " INV" after "TA". So the pieces inside one array join with
 * nothing (they are a single line) while separate operators join with a space
 * (they are separate lines). Getting that backwards would glue wrapped words
 * together and fail a verbatim assertion for the wrong reason.
 *
 * The fonts in use are the standard single-byte ones, so a hex pair is one
 * character. Cheaper than a PDF parser dependency for a few content checks.
 */
export function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const lines: string[] = [];

  const decodeLiteral = (value: string) =>
    value
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));

  const decodeHex = (value: string) => {
    const digits = value.replace(/[^0-9a-fA-F]/g, "");
    let out = "";
    for (let i = 0; i + 1 < digits.length; i += 2) {
      out += String.fromCharCode(parseInt(digits.slice(i, i + 2), 16));
    }
    return out;
  };

  const streamPattern = /stream\r?\n?([\s\S]*?)endstream/g;
  const operatorPattern = /\[([^\]]*)\]\s*TJ|\(((?:\\.|[^\\()])*)\)\s*Tj|<([0-9a-fA-F\s]*)>\s*Tj/g;
  const piecePattern = /\(((?:\\.|[^\\()])*)\)|<([0-9a-fA-F\s]*)>/g;

  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw)) !== null) {
    let content = match[1];
    try {
      content = zlib.inflateSync(Buffer.from(content, "latin1")).toString("latin1");
    } catch {
      // Not a compressed stream (an image, say) — fall through to the raw bytes.
    }

    for (const op of content.matchAll(operatorPattern)) {
      if (op[1] !== undefined) {
        let line = "";
        for (const piece of op[1].matchAll(piecePattern)) {
          line += piece[1] !== undefined ? decodeLiteral(piece[1]) : decodeHex(piece[2]);
        }
        lines.push(line);
      } else if (op[2] !== undefined) {
        lines.push(decodeLiteral(op[2]));
      } else {
        lines.push(decodeHex(op[3]));
      }
    }
  }

  return lines.join(" ");
}

/** Collapses whitespace so an assertion isn't sensitive to where a line wrapped. */
export function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export async function downloadPdf(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
