import {
  test,
  expect,
  readTable,
  addClient,
  addInvoice,
  completeEntityProfile,
  COMPLETE_PROFILE,
  type AuditEntryShape,
} from "./fixtures";

/**
 * Phase 0 — the entity profile, currency configuration, and local backup.
 * These are the foundations invoicing is gated on.
 */

test.describe("entity profile", () => {
  test("blocks saving until the legally required fields are present", async ({ page }) => {
    await page.goto("/settings");

    await page.getByRole("button", { name: "Save profile" }).click();

    // GSTIN and the bank wire block cannot be omitted from a compliant export
    // invoice, so the form refuses rather than rendering blanks onto a PDF.
    await expect(page.getByText("Required on a GST tax invoice.")).toBeVisible();
    await expect(page.getByText("Required — clients wire to this account.")).toBeVisible();
    await expect(page.getByText("Required for international transfers.")).toBeVisible();

    const profile = await readTable<{ gstin: string }>(page, "entityProfile");
    expect(profile[0].gstin).toBe("");
  });

  test("persists the profile across a reload and logs the change", async ({ page }) => {
    await completeEntityProfile(page);

    await page.reload();
    await expect(page.getByLabel("GSTIN")).toHaveValue(COMPLETE_PROFILE.gstin);
    await expect(page.getByLabel("SWIFT / BIC code")).toHaveValue(COMPLETE_PROFILE.bankSwift);

    const audit = await readTable<AuditEntryShape>(page, "auditLog");
    expect(audit.map((entry) => entry.actionType)).toContain("entity_profile_updated");
  });

  test("previews the serial number the numbering settings would produce", async ({ page }) => {
    await page.goto("/settings");

    await page.getByLabel("Serial prefix").fill("RGHUF/INV");
    await page.getByLabel("Sequence digits").fill("4");

    await expect(page.getByText(/RGHUF\/INV\/\d{2}-\d{2}\/0001/)).toBeVisible();
  });

  test("warns on the dashboard while the profile is incomplete", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Invoice PDFs need your entity and bank details first/)).toBeVisible();

    await completeEntityProfile(page);

    await page.goto("/");
    await expect(
      page.getByText(/Invoice PDFs need your entity and bank details first/)
    ).toBeHidden();
  });
});

test.describe("currency configuration", () => {
  test("adds a currency without a redeploy and offers it on new invoices", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Currencies" }).click();

    await page.getByLabel("Code").fill("chf");
    await page.getByLabel("Name").fill("Swiss Franc");
    await page.getByLabel("Symbol").fill("Fr.");
    await page.getByRole("button", { name: "Add" }).click();

    // Codes are normalised to upper case regardless of how they were typed.
    await expect(page.getByText("CHF added.")).toBeVisible();

    await completeEntityProfile(page);
    await addClient(page, { name: "Zurich AG", country: "Switzerland" });

    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();
    await page.getByRole("dialog").getByLabel("Currency").click();
    await expect(page.getByRole("option", { name: /^CHF/ })).toBeVisible();
  });

  test("keeps the base currency locked and hides deactivated ones from invoices", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Currencies" }).click();

    // INR is the reporting currency — it can never be switched off.
    await expect(page.getByLabel("INR active")).toBeDisabled();

    await page.getByLabel("EUR active").click();
    await expect(page.getByLabel("EUR active")).not.toBeChecked();

    await completeEntityProfile(page);
    await addClient(page, { name: "Berlin GmbH", country: "Germany" });

    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();
    await page.getByRole("dialog").getByLabel("Currency").click();

    await expect(page.getByRole("option", { name: /^USD/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /^EUR/ })).toBeHidden();
  });

  test("leaves an existing invoice's currency intact after it is deactivated", async ({ page }) => {
    await completeEntityProfile(page);
    await addClient(page, { name: "Paris SARL", country: "France", currency: "EUR" });
    const serial = await addInvoice(page, { clientName: "Paris SARL", fxRate: "95.5" });

    await page.goto("/settings");
    await page.getByRole("tab", { name: "Currencies" }).click();
    await page.getByLabel("EUR active").click();

    await page.goto("/invoices");
    await expect(page.getByText(serial, { exact: true }).first()).toBeVisible();

    const invoices = await readTable<{ serialNumber: string; currency: string }>(page, "invoices");
    expect(invoices.find((i) => i.serialNumber === serial)?.currency).toBe("EUR");
  });
});

test.describe("local backup", () => {
  test("exports the whole database as a restorable file", async ({ page }) => {
    await completeEntityProfile(page);
    await addClient(page, { name: "Acme Inc", country: "United States" });
    await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.25" });

    await page.goto("/settings");
    await page.getByRole("tab", { name: "Backup" }).click();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^vrikshafx-backup-\d{4}-\d{2}-\d{2}\.json$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const backup = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    expect(backup.format).toBe("vrikshafx-backup");
    expect(backup.data.invoices).toHaveLength(1);
    expect(backup.data.clients).toHaveLength(1);
    expect(backup.data.entityProfile[0].gstin).toBe(COMPLETE_PROFILE.gstin);
    // The ledger and audit trail travel with the backup — this file is the only
    // disaster-recovery path for them.
    expect(backup.data.ledgerEntries.length).toBeGreaterThan(0);
    expect(backup.data.auditLog.length).toBeGreaterThan(0);
    expect(backup.data.counters.length).toBeGreaterThan(0);
  });

  test("restores a backup over the current data after confirmation", async ({ page }) => {
    await completeEntityProfile(page);
    await addClient(page, { name: "Original Client", country: "United States" });
    const originalSerial = await addInvoice(page, { clientName: "Original Client", fxRate: "83.25" });

    await page.goto("/settings");
    await page.getByRole("tab", { name: "Backup" }).click();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const download = await downloadPromise;
    const backupPath = await download.path();

    // Diverge from the backup so the restore has something to overwrite.
    await addClient(page, { name: "Added After Backup", country: "Germany" });
    await expect(page.getByText("Added After Backup", { exact: true })).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("tab", { name: "Backup" }).click();
    await page.setInputFiles('input[type="file"]', backupPath!);

    // Restoring replaces rather than merges, so it must be confirmed.
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByText(/Replace all local data\?/)).toBeVisible();
    await page.getByRole("button", { name: "Replace all data" }).click();
    await expect(page.getByText(/Restored 1 invoice/)).toBeVisible();

    await page.goto("/clients");
    await expect(page.getByText("Original Client", { exact: true })).toBeVisible();
    await expect(page.getByText("Added After Backup", { exact: true })).toBeHidden();

    await page.goto("/invoices");
    await expect(page.getByText(originalSerial, { exact: true }).first()).toBeVisible();

    const audit = await readTable<AuditEntryShape>(page, "auditLog");
    const importEntry = audit.find((entry) => entry.actionType === "data_imported");
    expect(importEntry).toBeDefined();
    expect(importEntry!.isManualOverride).toBe(true);
  });

  test("rejects a file that is not a VrikshaFX backup", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Backup" }).click();

    await page.setInputFiles('input[type="file"]', {
      name: "not-a-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ hello: "world" })),
    });

    await expect(page.getByText("That file is not a VrikshaFX backup.")).toBeVisible();
    await expect(page.getByRole("alertdialog")).toBeHidden();
  });
});
