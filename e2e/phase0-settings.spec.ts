import {
  test,
  expect,
  readTable,
  addClient,
  addInvoice,
  completeEntityProfile,
  COMPLETE_PROFILE,
  IFSC_DIRECTORY_URL,
  type AuditEntryShape,
} from "./fixtures";

/**
 * Phase 0 — the entity profile, currency configuration, and local backup.
 * These are the foundations invoicing is gated on.
 */

test.describe("entity profile", () => {
  test("saves a partly filled profile without demanding the rest", async ({ page }) => {
    await page.goto("/settings");

    // A profile is assembled over weeks — the LUT number and SWIFT code arrive
    // long after the name does. Every field is optional to save; what a
    // compliant invoice needs is enforced at PDF generation instead.
    await page.getByLabel("Legal name").fill("Rahul Goel HUF");
    await page.getByLabel("PAN").fill("AAAAA0000A");
    await page.getByRole("button", { name: "Save profile" }).click();

    await expect(page.getByText("Entity profile saved.")).toBeVisible();

    const profile = await readTable<{ legalName: string; pan: string; gstin: string }>(
      page,
      "entityProfile"
    );
    expect(profile[0].legalName).toBe("Rahul Goel HUF");
    expect(profile[0].pan).toBe("AAAAA0000A");
    expect(profile[0].gstin).toBe("");
  });

  test("names what is still missing before an invoice can be issued", async ({ page }) => {
    await page.goto("/settings");

    // Guidance, not a blocker — the save button stays live throughout.
    const banner = page.getByText(/an invoice PDF cannot be generated until/);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("GSTIN");
    await expect(banner).toContainText("SWIFT/BIC code");
    await expect(page.getByRole("button", { name: "Save profile" })).toBeEnabled();

    await completeEntityProfile(page);
    await expect(page.getByText(/an invoice PDF cannot be generated until/)).toBeHidden();
  });

  test("still rejects a malformed value in an optional field", async ({ page }) => {
    await page.goto("/settings");

    // Optional means "may be left blank", not "is never checked" — a typo is a
    // mistake, not a deferral.
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Save profile" }).click();

    await expect(page.getByText("Enter a valid email address.")).toBeVisible();

    const profile = await readTable<{ email: string }>(page, "entityProfile");
    expect(profile[0].email).toBe("");
  });

  test("falls back to a well-formed serial when the numbering fields are blank", async ({
    page,
  }) => {
    await page.goto("/settings");

    await page.getByLabel("Serial prefix").fill("");
    await page.getByLabel("Sequence digits").fill("");

    // Blank numbering settings must not yield "//26-27/1".
    await expect(page.getByText(/RGHUF\/INV\/\d{2}-\d{2}\/001/)).toBeVisible();

    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Entity profile saved.")).toBeVisible();

    const profile = await readTable<{ invoiceSerialPadding: number }>(page, "entityProfile");
    expect(profile[0].invoiceSerialPadding).toBe(3);
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

test.describe("IFSC branch lookup", () => {
  test("fills the bank and branch from the IFSC code", async ({ page }) => {
    await page.goto("/settings");

    await page.getByLabel("IFSC code").fill("icic0001234");

    // Codes are normalised as typed — the directory only answers upper case.
    await expect(page.getByLabel("IFSC code")).toHaveValue("ICIC0001234");
    await expect(page.getByText("ICICI Bank — BANDRA KURLA COMPLEX, MUMBAI")).toBeVisible();

    await expect(page.getByLabel("Bank name")).toHaveValue("ICICI Bank");
    await expect(page.getByLabel("Branch")).toHaveValue("BANDRA KURLA COMPLEX");
    // This branch publishes a SWIFT code; most do not.
    await expect(page.getByLabel("SWIFT / BIC code")).toHaveValue("ICICINBBCTS");

    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Entity profile saved.")).toBeVisible();

    const profile = await readTable<{ bankName: string; bankBranch: string }>(
      page,
      "entityProfile"
    );
    expect(profile[0].bankName).toBe("ICICI Bank");
    expect(profile[0].bankBranch).toBe("BANDRA KURLA COMPLEX");
  });

  test("never overwrites details already typed in, but offers to", async ({ page }) => {
    await page.goto("/settings");

    // Whoever typed this called their bank. The directory does not get to
    // silently overrule them.
    await page.getByLabel("Bank name").fill("HDFC Bank Ltd");
    await page.getByLabel("IFSC code").fill("HDFC0000123");

    await expect(page.getByText("HDFC Bank — NEHRU PLACE, NEW DELHI")).toBeVisible();
    await expect(page.getByLabel("Bank name")).toHaveValue("HDFC Bank Ltd");

    // Branch was empty, so it filled on its own.
    await expect(page.getByLabel("Branch")).toHaveValue("NEHRU PLACE");

    await page.getByRole("button", { name: "Use these details" }).click();
    await expect(page.getByLabel("Bank name")).toHaveValue("HDFC Bank");
  });

  test("leaves manual entry working when the directory is unreachable", async ({ page }) => {
    // Registered after the auto-fixture's stub, so this handler wins.
    await page.route(IFSC_DIRECTORY_URL, (route) => route.abort("failed"));

    await page.goto("/settings");
    await page.getByLabel("IFSC code").fill("HDFC0000123");

    await expect(page.getByText(/Could not reach the IFSC directory/)).toBeVisible();

    // The lookup is a convenience, never a gate: the wire block is still
    // fillable and savable by hand.
    await page.getByLabel("Bank name").fill("HDFC Bank");
    await page.getByLabel("Branch").fill("Nehru Place");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Entity profile saved.")).toBeVisible();

    const profile = await readTable<{ bankName: string; bankIfsc: string }>(page, "entityProfile");
    expect(profile[0].bankName).toBe("HDFC Bank");
    expect(profile[0].bankIfsc).toBe("HDFC0000123");
  });

  test("says so when the code is not in the directory", async ({ page }) => {
    await page.goto("/settings");

    // Well-formed, but no such branch — the stub answers 404 as the real
    // directory does.
    await page.getByLabel("IFSC code").fill("ZZZZ0999999");

    await expect(page.getByText(/No branch found for this IFSC/)).toBeVisible();
    await expect(page.getByLabel("Bank name")).toHaveValue("");
  });

  test("does not call the directory for a half-typed code", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      if (/ifsc\.razorpay\.com/.test(request.url())) calls.push(request.url());
    });

    await page.goto("/settings");
    await page.getByLabel("IFSC code").fill("HDFC00");

    await expect(page.getByText(/the bank and branch fill in automatically/)).toBeVisible();
    expect(calls).toEqual([]);
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
