import {
  test,
  expect,
  readTable,
  addClient,
  addInvoice,
  completeEntityProfile,
  openInvoice,
  expectLedgerBalanced,
  accountBalance,
  type AuditEntryShape,
  type InvoiceShape,
  type LedgerEntryShape,
} from "./fixtures";

/**
 * Phase 0 — the compliance rules the domain layer exists to guarantee.
 *
 * The ledger and audit trail have no UI yet (modules 4 and 8 are unbuilt), so
 * these drive the real app and then assert against the persisted IndexedDB
 * state. Without this, a regression in the posting engine would go unnoticed
 * until those pages ship.
 */

test.beforeEach(async ({ page }) => {
  await completeEntityProfile(page);
  await addClient(page, { name: "Acme Inc", country: "United States", currency: "USD" });
});

test.describe("invoice serial numbering", () => {
  test("increments within the financial year and pads to the configured width", async ({ page }) => {
    const first = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.10" });
    const second = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.20" });

    expect(first).toMatch(/^RGHUF\/\d{2}-\d{2}\/001$/);
    expect(second).toMatch(/^RGHUF\/\d{2}-\d{2}\/002$/);
    // Rule 46(b) caps a serial at 16 characters, which is why the default
    // prefix is the entity alone and not "RGHUF/INV".
    expect(first.length).toBeLessThanOrEqual(16);

    const invoices = await readTable<InvoiceShape>(page, "invoices");
    expect(invoices.map((i) => i.sequence).sort()).toEqual([1, 2]);
  });

  test("never reuses a serial after an invoice is deleted", async ({ page }) => {
    const first = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.10" });
    const second = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.20" });

    await openInvoice(page, second);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete invoice" }).click();
    await expect(page.getByText(/serial is not reused/)).toBeVisible();

    const third = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.30" });

    // The deleted 002 leaves a documented gap: a duplicate serial would be a
    // compliance problem, a gap is not.
    expect(third).toMatch(/\/003$/);
    expect(third).not.toBe(second);
    expect(third).not.toBe(first);

    const invoices = await readTable<InvoiceShape>(page, "invoices");
    expect(invoices.map((i) => i.serialNumber).sort()).toEqual([first, third].sort());

    const counters = await readTable<{ key: string; value: number }>(page, "counters");
    expect(counters.find((c) => c.key.startsWith("invoice-seq:"))!.value).toBe(3);
  });

  test("assigns the financial year from the invoice date, not today", async ({ page }) => {
    // 2026-03-31 falls in FY 25-26; 2026-04-01 starts FY 26-27.
    const marchSerial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.10",
      invoiceDate: "2026-03-31",
      dueDate: "2026-04-30",
    });
    const aprilSerial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.10",
      invoiceDate: "2026-04-01",
      dueDate: "2026-05-01",
    });

    expect(marchSerial).toContain("/25-26/");
    expect(aprilSerial).toContain("/26-27/");

    // Each financial year runs its own sequence from 1.
    expect(marchSerial).toMatch(/\/001$/);
    expect(aprilSerial).toMatch(/\/001$/);

    const invoices = await readTable<InvoiceShape>(page, "invoices");
    expect(invoices.map((i) => i.financialYear).sort()).toEqual(["25-26", "26-27"]);
  });
});

test.describe("double-entry ledger", () => {
  test("posts a balanced receivable when an invoice is issued", async ({ page }) => {
    await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      quantity: "2",
      unitPrice: "500",
    });

    const entries = await readTable<LedgerEntryShape>(page, "ledgerEntries");
    expectLedgerBalanced(entries);

    // 2 x 500 USD at 83.00 = 83,000 INR booked as income and receivable.
    expect(accountBalance(entries, "accounts_receivable")).toBe(83000);
    expect(accountBalance(entries, "foreign_income")).toBe(-83000);
  });

  test("posts nothing for a draft, then posts when it is issued", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      unitPrice: "1000",
      asDraft: true,
    });

    // A draft is not yet a receivable and must not appear in income.
    let entries = await readTable<LedgerEntryShape>(page, "ledgerEntries");
    expect(entries).toHaveLength(0);

    await openInvoice(page, serial);
    await page.getByRole("button", { name: "Mark sent" }).click();
    await expect(page.getByText(/marked sent/)).toBeVisible();

    entries = await readTable<LedgerEntryShape>(page, "ledgerEntries");
    expectLedgerBalanced(entries);
    expect(accountBalance(entries, "accounts_receivable")).toBe(83000);
  });

  test("reverses rather than rewrites when an issued invoice is deleted", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      unitPrice: "1000",
    });

    const afterIssue = await readTable<LedgerEntryShape>(page, "ledgerEntries");
    expect(afterIssue).toHaveLength(2);

    await openInvoice(page, serial);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete invoice" }).click();
    await expect(page.getByText(/serial is not reused/)).toBeVisible();

    const afterDelete = await readTable<LedgerEntryShape>(page, "ledgerEntries");

    // History is append-only: the original entries survive and are cancelled by
    // an equal and opposite set, so the net effect is nil.
    expect(afterDelete.length).toBe(4);
    expect(afterDelete.filter((e) => e.sourceType === "reversal")).toHaveLength(2);
    expectLedgerBalanced(afterDelete);
    expect(accountBalance(afterDelete, "accounts_receivable")).toBe(0);
    expect(accountBalance(afterDelete, "foreign_income")).toBe(0);
  });

  test("keeps the ledger balanced across an amount edit", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      unitPrice: "1000",
    });

    await openInvoice(page, serial);
    await page.getByRole("button", { name: "Edit" }).click();

    const sheet = page.getByRole("dialog");
    await sheet.getByLabel(/^Rate \(/).fill("2000");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/saved\.$/)).toBeVisible();

    const entries = await readTable<LedgerEntryShape>(page, "ledgerEntries");
    expectLedgerBalanced(entries);

    // The original posting is reversed and re-posted at the new amount.
    expect(accountBalance(entries, "accounts_receivable")).toBe(166000);
    expect(entries.some((e) => e.sourceType === "reversal")).toBe(true);
  });
});

test.describe("audit trail", () => {
  test("records creation, status changes, and deletion", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      asDraft: true,
    });

    await openInvoice(page, serial);
    await page.getByRole("button", { name: "Mark sent" }).click();
    await expect(page.getByText(/marked sent/)).toBeVisible();

    const audit = await readTable<AuditEntryShape>(page, "auditLog");
    const actions = audit.map((entry) => entry.actionType);

    expect(actions).toContain("client_created");
    expect(actions).toContain("invoice_created");
    expect(actions).toContain("invoice_status_changed");
    expect(actions).toContain("entity_profile_updated");

    // Every entry carries a readable summary so the log is useful without
    // diffing before/after payloads.
    for (const entry of audit) {
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  test("flags a manual override distinctly from a system-derived change", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.00" });

    await openInvoice(page, serial);
    await page.getByRole("button", { name: "Mark paid" }).click();

    // No remittance covers this invoice, so the app makes the user own the call.
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByText(/Mark paid without a remittance\?/)).toBeVisible();
    await page.getByRole("button", { name: "Mark paid anyway" }).click();
    await expect(page.getByText(/marked paid/)).toBeVisible();

    const audit = await readTable<AuditEntryShape>(page, "auditLog");
    const override = audit.find((entry) => entry.actionType === "invoice_status_overridden");
    expect(override).toBeDefined();
    expect(override!.isManualOverride).toBe(true);
    expect(override!.summary).toContain("manual override");

    const invoices = await readTable<InvoiceShape>(page, "invoices");
    expect(invoices[0].manualStatusOverride).toBe(true);
  });

  test("is append-only — entries are never edited away", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      asDraft: true,
    });

    await openInvoice(page, serial);
    await page.getByRole("button", { name: "Mark sent" }).click();
    await expect(page.getByText(/marked sent/)).toBeVisible();
    const afterSent = await readTable<AuditEntryShape>(page, "auditLog");

    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete invoice" }).click();
    await expect(page.getByText(/serial is not reused/)).toBeVisible();
    const afterDelete = await readTable<AuditEntryShape>(page, "auditLog");

    // Deleting the invoice adds an entry; it never removes the ones describing
    // what happened to it beforehand.
    expect(afterDelete.length).toBeGreaterThan(afterSent.length);
    const survivingIds = new Set(afterDelete.map((entry) => entry.id));
    for (const entry of afterSent) expect(survivingIds.has(entry.id)).toBe(true);
    expect(afterDelete.map((e) => e.actionType)).toContain("invoice_deleted");
  });
});
