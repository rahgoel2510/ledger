import {
  test,
  expect,
  readTable,
  extractPdfText,
  flatten,
  downloadPdf,
  addClient,
  addInvoice,
  completeEntityProfile,
  openInvoice,
  COMPLETE_PROFILE,
  type AuditEntryShape,
} from "./fixtures";

/**
 * Phase 1 — invoice PDF generation (module 1, US-2).
 *
 * The PDF is the one artefact that leaves this app and lands in front of a
 * client and, eventually, a tax officer. These tests extract the text back out
 * of the generated file and assert the mandatory content is present verbatim.
 */

const IGST_DISCLAIMER =
  "SUPPLY MEANT FOR EXPORT OF SERVICES UNDER LETTER OF UNDERTAKING (LUT) WITHOUT PAYMENT OF INTEGRATED TAX (IGST). REMITTANCE TO BE CREDITED IN FOREIGN CURRENCY TO RAHUL GOEL HUF BANK ACCOUNT.";

test.describe("invoice PDF", () => {
  test.beforeEach(async ({ page }) => {
    await completeEntityProfile(page);
    await addClient(page, {
      name: "Acme Inc",
      country: "United States",
      currency: "USD",
      taxId: "EIN 12-3456789",
      billingAddress: "500 Market St\nSan Francisco, CA 94105",
    });
  });

  test("generates a valid PDF without contacting any other origin", async ({ page, baseURL }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.25",
      quantity: "10",
      unitPrice: "150",
    });

    await openInvoice(page, serial);

    // Module 1 US-2 is about generation being client-side. Asserting "no
    // third-party request" is the real property; flipping the context offline
    // would only prove that the dev server lazily serves its own JS chunks over
    // HTTP, which the service worker caches in production anyway.
    //
    // The app does make exactly one outbound call — the IFSC branch lookup — but
    // it lives in Settings and sends only a branch code. Nothing on the path
    // from invoice to PDF may leave the machine.
    const foreign: string[] = [];
    const origin = new URL(baseURL!).origin;
    // `blob:` and `data:` never leave the browser — the generated PDF is handed
    // to the download as a blob URL, so it shows up here as a "request".
    const isLocal = (url: string) =>
      url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:");
    page.on("request", (request) => {
      if (!isLocal(request.url())) foreign.push(request.url());
    });

    const pdf = await downloadPdf(page);

    expect(foreign).toEqual([]);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  test("carries the IGST export disclaimer verbatim", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.25" });
    await openInvoice(page, serial);

    const text = flatten(extractPdfText(await downloadPdf(page)));

    // Verbatim, exactly as specified in CLAUDE.md — no rewording or re-casing.
    expect(text).toContain(IGST_DISCLAIMER);
  });

  test("carries the full bank wire block", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.25" });
    await openInvoice(page, serial);

    const text = flatten(extractPdfText(await downloadPdf(page)));

    // An overseas client cannot pay without all four of these.
    expect(text).toContain(COMPLETE_PROFILE.bankName);
    expect(text).toContain(COMPLETE_PROFILE.bankAccountNumber);
    expect(text).toContain(COMPLETE_PROFILE.bankIfsc);
    expect(text).toContain(COMPLETE_PROFILE.bankSwift);
    expect(text).toContain("SWIFT / BIC CODE");
  });

  test("shows the serial, client, zero-rated IGST line, and frozen FX rate", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.2500",
      description: "Platform engineering",
      quantity: "10",
      unitPrice: "150",
    });
    await openInvoice(page, serial);

    const text = flatten(extractPdfText(await downloadPdf(page)));

    expect(text).toContain("TAX INVOICE");
    expect(text).toContain(serial);
    expect(text).toContain("Acme Inc");
    expect(text).toContain("San Francisco");
    expect(text).toContain("EIN 12-3456789");
    expect(text).toContain("Platform engineering");
    expect(text).toContain(COMPLETE_PROFILE.gstin);

    // IGST on export of services under LUT is always zero.
    expect(text).toContain("IGST @ 0%");
    expect(text).toContain("Export of Services");

    // 10 x 150 = 1,500 USD; the frozen rate and INR equivalent both appear.
    expect(text).toContain("1,500.00");
    expect(text).toContain("83.2500");
    expect(text).toContain("1,24,875.00");
  });

  test("records every download in the audit trail", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.25" });
    await openInvoice(page, serial);

    await downloadPdf(page);
    await expect(page.getByText("PDF downloaded.")).toBeVisible();
    await downloadPdf(page);

    const audit = await readTable<AuditEntryShape>(page, "auditLog");
    const downloads = audit.filter((entry) => entry.actionType === "invoice_pdf_downloaded");

    // Each download is its own entry, timestamped — module 1 US-2.
    expect(downloads).toHaveLength(2);
    expect(downloads[0].summary).toContain(serial);
  });

  test("names the file after the serial and client", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.25" });
    await openInvoice(page, serial);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    const download = await downloadPromise;

    // Serials contain slashes, which a filename cannot.
    expect(download.suggestedFilename()).toBe(`${serial.replace(/\//g, "-")}-Acme-Inc.pdf`);
  });

  test("still generates while a mandatory bank field is blank, and says so", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.25" });

    // Generation used to be refused here. It no longer is: the profile is filled
    // in over weeks, and a draft that cannot be produced at all is worse than one
    // visibly marked unfinished. Clear the SWIFT code at the store, since the
    // form would only ever hold the placeholder or a real value.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("vrikshafx");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("entityProfile", "readwrite");
            const store = tx.objectStore("entityProfile");
            const get = store.get("default");
            get.onsuccess = () => store.put({ ...get.result, bankSwift: "" });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
        })
    );

    await openInvoice(page, serial);
    const text = flatten(await extractPdfText(await downloadPdf(page)));

    // The wire block keeps the row and marks it. Dropping the row would read as
    // though the bank has no SWIFT code, rather than as unfinished.
    expect(text).toMatch(/SWIFT \/ BIC CODE\s+NOT PROVIDED/);

    // Nothing blocks the download, so the audit trail is the only record of what
    // the document actually went out carrying.
    const audit = await readTable<AuditEntryShape>(page, "auditLog");
    const download = audit.filter((e) => e.actionType === "invoice_pdf_downloaded").at(-1);
    expect(download?.summary).toContain("unconfirmed particulars");
    expect(download?.summary).toContain("SWIFT/BIC code");
    expect(download?.isManualOverride).toBe(true);
  });
});
