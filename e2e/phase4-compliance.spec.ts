import {
  test,
  expect,
  readTable,
  addClient,
  addInvoice,
  completeEntityProfile,
  openInvoice,
  openPrimaryAction,
  setLineItemMode,
  extractPdfText,
  flatten,
  downloadPdf,
  COMPLETE_PROFILE,
} from "./fixtures";

/**
 * Phase 4 — statutory particulars on the invoice, for both jurisdictions it is
 * read in.
 *
 * The supplier is an Indian entity, so the document is an Indian tax invoice
 * whoever it is addressed to: Rule 46 of the CGST Rules lists what it must
 * carry. The recipient is usually a US company, whose payables desk needs
 * enough on the page to book the invoice and release the full amount rather
 * than withhold 30% under Chapter 3.
 *
 * These assertions read the generated PDF, not the editor. A particular that is
 * stored but never printed is not compliance — the PDF is the document that
 * leaves the app and lands in front of a tax officer, so that is what is
 * checked. `compliance.ts` is the authority on why each line is required.
 */

const REVERSE_CHARGE_NO = "Tax payable on reverse charge basis: NO";
const REVERSE_CHARGE_YES = "Tax payable on reverse charge basis: YES";
const US_SOURCE =
  "Services were performed entirely outside the United States by a non-US person. The income is not US-source under IRC s.861(a)(3) and is not subject to US federal withholding.";
const US_SALES_TAX =
  "No US sales, use, or excise tax has been charged: the supplier is a non-US entity with no US business nexus.";

/** Generates a PDF for the named invoice and hands back its flattened text. */
async function pdfTextFor(
  page: import("@playwright/test").Page,
  serial: string
): Promise<string> {
  await openInvoice(page, serial);
  return flatten(extractPdfText(await downloadPdf(page)));
}

test.describe("export invoice — Rule 46 particulars", () => {
  test.beforeEach(async ({ page }) => {
    await completeEntityProfile(page);
    await addClient(page, {
      name: "Acme Inc",
      country: "United States",
      currency: "USD",
      taxId: "EIN 12-3456789",
      billingAddress: "500 Market St\nSan Francisco, CA 94105",
      deliveryAddress: "1 Infinite Loop\nCupertino, CA 95014",
      sacCode: "998313",
    });
  });

  test("prints every particular Rule 46 requires of an export invoice", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.25",
      description: "Software consulting",
      quantity: "10",
      unitPrice: "150",
    });

    const text = await pdfTextFor(page, serial);

    // 46(a) supplier particulars, including the State the place of supply is
    // stated against.
    expect(text).toContain(COMPLETE_PROFILE.legalName);
    expect(text).toContain(`GSTIN: ${COMPLETE_PROFILE.gstin}`);
    expect(text).toContain(`State: ${COMPLETE_PROFILE.state} (${COMPLETE_PROFILE.stateCode})`);
    // 46(b) the serial, within the 16-character cap.
    expect(text).toContain(serial);
    expect(serial.length).toBeLessThanOrEqual(16);
    // 46(g) the accounting code — required on an export just as on a domestic supply.
    expect(text).toContain("SAC code: 998313");
    // 46(n)/(r) place of supply, said to be outside India, and the destination named.
    expect(text).toContain("Place of supply: Outside India - United States");
    expect(text).toContain("Country of destination: United States");
    // 46(o) the delivery address, because it is not the billing address.
    expect(text).toContain("ADDRESS OF DELIVERY");
    expect(text).toContain("1 Infinite Loop");
    // 46(p) answered rather than left silent.
    expect(text).toContain(REVERSE_CHARGE_NO);
    // 46(q) the signature block, over the signatory's name.
    expect(text).toContain(`For ${COMPLETE_PROFILE.legalName}`);
    expect(text).toContain(COMPLETE_PROFILE.authorisedSignatory);
    expect(text).toContain("Authorised Signatory");
    // The LUT the zero-rating rests on.
    expect(text).toContain(`LUT: ${COMPLETE_PROFILE.lutNumber}`);

    // The old footer claimed no signature was required, which Rule 46(q) says
    // is not so. It must not come back.
    expect(text).not.toContain("No signature required");
  });

  test("spells the total out in the invoice currency", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.25",
      description: "Software consulting",
      quantity: "10",
      unitPrice: "150",
    });

    const text = await pdfTextFor(page, serial);
    // 1,500 USD — grouped the international way, not in lakhs, because the
    // reader of a USD invoice is not an Indian one.
    expect(text).toContain("US Dollars One Thousand Five Hundred Only");
    expect(text).not.toContain("Lakh");
  });

  test("carries the US statements a payables desk needs to release the full amount", async ({
    page,
  }) => {
    await page.goto("/invoices");
    await openPrimaryAction(page, "New invoice");
    const sheet = page.getByRole("dialog");

    await sheet.getByLabel("Client").click();
    await page.getByRole("option", { name: /Acme Inc/ }).click();
    await sheet.getByLabel(/Exchange rate on invoice date/).fill("83.25");
    await setLineItemMode(page, "fixed");
    await sheet.getByLabel("Description").fill("Software consulting");
    await sheet.getByLabel("Qty").fill("10");
    await sheet.getByLabel(/^Rate \(/).fill("150");
    await sheet.getByLabel("PO / reference number").fill("PO-2027-0042");
    await sheet.getByRole("button", { name: "Save & issue" }).click();
    await expect(page.getByText(/issued\.$/)).toBeVisible();

    const invoices = await readTable<{ serialNumber: string; poNumber?: string }>(page, "invoices");
    expect(invoices[0].poNumber).toBe("PO-2027-0042");

    const text = await pdfTextFor(page, invoices[0].serialNumber);
    // The PO is what an AP clerk matches the invoice against; without it many
    // desks will not process it at all.
    expect(text).toContain("PO / Reference");
    expect(text).toContain("PO-2027-0042");
    expect(text).toContain(US_SOURCE);
    expect(text).toContain(US_SALES_TAX);
    expect(text).toContain(COMPLETE_PROFILE.usTaxFormReference);
    expect(text).toContain(`Supplier foreign TIN (India PAN): ${COMPLETE_PROFILE.pan}`);
  });

  test("omits the delivery address when it is the billing address", async ({ page }) => {
    await addClient(page, {
      name: "Globex GmbH",
      country: "Germany",
      currency: "EUR",
      billingAddress: "Friedrichstrasse 12\n10117 Berlin",
    });

    const serial = await addInvoice(page, {
      clientName: "Globex GmbH",
      fxRate: "92",
      description: "Advisory retainer",
      quantity: "1",
      unitPrice: "2000",
    });

    const text = await pdfTextFor(page, serial);
    expect(text).toContain("Friedrichstrasse 12");
    // Repeating the same address under a second heading tells the reader
    // nothing, and 46(o) only asks for it where it differs.
    expect(text).not.toContain("ADDRESS OF DELIVERY");
    // Not a US recipient, so the US block has no business being on the page.
    expect(text).not.toContain(US_SOURCE);
  });
});

test.describe("domestic invoice — Rule 46 particulars", () => {
  test.beforeEach(async ({ page }) => {
    await completeEntityProfile(page);
  });

  test("names the recipient's State and answers the reverse-charge question", async ({ page }) => {
    await page.goto("/clients");
    await openPrimaryAction(page, "New client");
    const clientSheet = page.getByRole("dialog");
    await clientSheet.getByLabel("Client name").fill("Bharat Systems Pvt Ltd");
    // Place of supply is stated, not inferred from the country — and it is what
    // opens the domestic tax block and puts the base currency on the list.
    await clientSheet.getByLabel("Place of supply").click();
    await page.getByRole("option", { name: /Domestic supply/ }).click();
    await clientSheet.getByLabel("Country").fill("India");
    await clientSheet.getByLabel("Default currency").click();
    await page.getByRole("option", { name: /^INR\b/ }).click();
    await clientSheet.getByLabel("Billing address").fill("42 MG Road\nBengaluru 560001");
    await clientSheet.getByLabel("SAC code").fill("998313");
    await clientSheet.getByLabel("State", { exact: true }).fill("Karnataka");
    await clientSheet.getByLabel("Client GSTIN").fill("29AAAAA0000A1Z5");
    await clientSheet.getByRole("button", { name: "Add client" }).click();
    await expect(page.getByText("Bharat Systems Pvt Ltd added.")).toBeVisible();

    await page.goto("/invoices");
    await openPrimaryAction(page, "New invoice");
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Client").click();
    await page.getByRole("option", { name: /Bharat Systems/ }).click();
    await setLineItemMode(page, "fixed");
    await sheet.getByLabel("Description").fill("Implementation support");
    await sheet.getByLabel("Qty").fill("1");
    await sheet.getByLabel(/^Rate \(/).fill("50000");
    // 46(p) is a question about this supply, so the answer is per invoice.
    await sheet.getByLabel("Tax payable on reverse charge").click();
    await sheet.getByRole("button", { name: "Save & issue" }).click();
    await expect(page.getByText(/issued\.$/)).toBeVisible();

    const invoices = await readTable<{ serialNumber: string; reverseCharge?: boolean }>(
      page,
      "invoices"
    );
    expect(invoices[0].reverseCharge).toBe(true);

    const text = await pdfTextFor(page, invoices[0].serialNumber);
    expect(text).toContain("Place of supply: Karnataka");
    expect(text).toContain("Recipient GSTIN: 29AAAAA0000A1Z5");
    expect(text).toContain(REVERSE_CHARGE_YES);
    // An INR invoice is read by an Indian auditor, so the words group in lakhs.
    expect(text).toContain("Rupees Fifty Nine Thousand Only");
    // Domestic supply — the export declaration has no place on it.
    expect(text).not.toContain("EXPORT OF SERVICES UNDER LETTER OF UNDERTAKING");
    expect(text).not.toContain("Country of destination");
  });
});

test.describe("missing particulars", () => {
  test("gates the PDF on the signatory Rule 46(q) requires", async ({ page }) => {
    // Everything but the signatory. The dashboard warning is the same gate the
    // download button sits behind.
    await completeEntityProfile(page, { authorisedSignatory: "" });
    await page.goto("/");
    await expect(
      page.getByText(/Invoices will print with/)
    ).toBeVisible();
    await expect(page.getByText(/Authorised signatory/)).toBeVisible();
  });

  test("reports what is missing on the invoice rather than refusing to produce it", async ({
    page,
  }) => {
    // A profile with no LUT and a client with no SAC code: both are Rule 46
    // particulars, and neither can be judged until an invoice exists.
    await completeEntityProfile(page, { lutNumber: "", usTaxFormReference: "" });
    await addClient(page, {
      name: "Initech LLC",
      country: "United States",
      currency: "USD",
      billingAddress: "1 Ranch Rd\nAustin, TX 78701",
    });

    const serial = await addInvoice(page, {
      clientName: "Initech LLC",
      fxRate: "83",
      description: "Software consulting",
      quantity: "4",
      unitPrice: "200",
    });

    await openInvoice(page, serial);
    const detail = page.getByRole("dialog");
    await expect(detail.getByText("MISSING PARTICULARS")).toBeVisible();
    await expect(detail.getByText(/SAC code for the service/)).toBeVisible();
    await expect(detail.getByText(/LUT reference/)).toBeVisible();
    await expect(detail.getByText(/W-8BEN-E reference/)).toBeVisible();
    await expect(detail.getByText(/Purchase order \/ reference number/)).toBeVisible();
    // Advisory, not a gate — the invoice is still a document the user can send.
    await expect(detail.getByRole("button", { name: "Download PDF" })).toBeEnabled();
    await expect(detail.getByText("US Dollars Eight Hundred Only")).toBeVisible();
  });
});
