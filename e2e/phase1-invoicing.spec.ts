import {
  test,
  expect,
  readTable,
  addClient,
  addInvoice,
  completeEntityProfile,
  openInvoice,
  setLineItemMode,
  type InvoiceShape,
} from "./fixtures";

/**
 * Phase 1 — invoicing (module 1): creation, the frozen FX rate, status
 * lifecycle, and list filtering.
 */

test.beforeEach(async ({ page }) => {
  await completeEntityProfile(page);
  await addClient(page, { name: "Acme Inc", country: "United States", currency: "USD" });
  await addClient(page, { name: "Globex GmbH", country: "Germany", currency: "EUR" });
});

test.describe("creating an invoice", () => {
  test("captures line items, totals, and the invoice-date FX rate", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.2500",
      description: "Platform engineering — March 2027",
      quantity: "10",
      unitPrice: "150",
    });

    const invoices = await readTable<InvoiceShape>(page, "invoices");
    const invoice = invoices.find((i) => i.serialNumber === serial)!;

    expect(invoice.currency).toBe("USD");
    expect(invoice.status).toBe("sent");
    expect(invoice.invoiceDateFxRate).toBe(83.25);
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.lineItems[0]).toMatchObject({
      description: "Platform engineering — March 2027",
      quantity: 10,
      unitPrice: 150,
    });

    await openInvoice(page, serial);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("$1,500.00").first()).toBeVisible();
    // 1,500 USD at 83.25 = 124,875 INR, in Indian digit grouping.
    await expect(sheet.getByText("₹1,24,875.00")).toBeVisible();
  });

  test("pre-fills the currency from the selected client", async ({ page }) => {
    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();

    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Client").click();
    await page.getByRole("option", { name: /Globex GmbH/ }).click();

    await expect(sheet.getByLabel("Currency")).toContainText("EUR");
  });

  test("defaults the due date from the configured payment terms", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel("Default payment terms (days)").fill("45");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Entity profile saved.")).toBeVisible();

    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();
    const sheet = page.getByRole("dialog");

    await sheet.getByLabel("Invoice date", { exact: true }).fill("2027-01-01");
    await expect(sheet.getByLabel("Due date", { exact: true })).toHaveValue("2027-02-15");
  });

  test("refuses to save without a client, rate, or line item amount", async ({ page }) => {
    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();

    const sheet = page.getByRole("dialog");
    await setLineItemMode(page, "fixed");
    await sheet.getByLabel("Description").fill("");
    await sheet.getByLabel(/^Rate \(/).fill("0");
    await sheet.getByRole("button", { name: "Save & issue" }).click();

    await expect(sheet.getByText("Select a client.")).toBeVisible();
    await expect(sheet.getByText("Enter the rate on the invoice date.")).toBeVisible();
    await expect(sheet.getByText("Describe the service.")).toBeVisible();
    await expect(sheet.getByText("Must be greater than zero.")).toBeVisible();

    expect(await readTable(page, "invoices")).toHaveLength(0);
  });

  test("rejects a due date before the invoice date", async ({ page }) => {
    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();

    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Client").click();
    await page.getByRole("option", { name: /Acme Inc/ }).click();
    await sheet.getByLabel(/Exchange rate on invoice date/).fill("83");
    await sheet.getByLabel("Invoice date", { exact: true }).fill("2027-03-10");
    await sheet.getByLabel("Due date", { exact: true }).fill("2027-03-01");
    await sheet.getByRole("button", { name: "Save & issue" }).click();

    await expect(sheet.getByText("Due date cannot be before the invoice date.")).toBeVisible();
  });

  test("supports multiple line items and sums them", async ({ page }) => {
    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();

    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Client").click();
    await page.getByRole("option", { name: /Acme Inc/ }).click();
    await sheet.getByLabel(/Exchange rate on invoice date/).fill("83");
    await setLineItemMode(page, "fixed");

    await sheet.getByLabel("Description").first().fill("Discovery workshop");
    await sheet.getByLabel("Qty").first().fill("1");
    await sheet.getByLabel(/^Rate \(/).first().fill("2000");

    await sheet.getByRole("button", { name: "Add line" }).click();
    await sheet.getByLabel("Description").nth(1).fill("Implementation");
    await sheet.getByLabel("Qty").nth(1).fill("3");
    await sheet.getByLabel(/^Rate \(/).nth(1).fill("500");

    // 2,000 + (3 x 500) = 3,500
    await expect(sheet.getByText("$3,500.00").first()).toBeVisible();

    await sheet.getByRole("button", { name: "Save & issue" }).click();
    await expect(page.getByText(/issued\.$/)).toBeVisible();

    const invoices = await readTable<InvoiceShape>(page, "invoices");
    expect(invoices[0].lineItems).toHaveLength(2);
  });

  test("keeps the frozen FX rate when the client is later re-invoiced at a new rate", async ({
    page,
  }) => {
    const first = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.00" });
    const second = await addInvoice(page, { clientName: "Acme Inc", fxRate: "87.50" });

    const invoices = await readTable<InvoiceShape>(page, "invoices");
    expect(invoices.find((i) => i.serialNumber === first)!.invoiceDateFxRate).toBe(83);
    expect(invoices.find((i) => i.serialNumber === second)!.invoiceDateFxRate).toBe(87.5);
  });
});

test.describe("status lifecycle", () => {
  test("starts as a draft when saved as one", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      asDraft: true,
    });

    await page.goto("/invoices");
    await expect(page.getByText("Draft").first()).toBeVisible();

    const invoices = await readTable<InvoiceShape>(page, "invoices");
    expect(invoices.find((i) => i.serialNumber === serial)!.status).toBe("draft");
  });

  test("moves draft to sent to paid", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      asDraft: true,
    });

    await openInvoice(page, serial);
    await page.getByRole("button", { name: "Mark sent" }).click();
    await expect(page.getByText(/marked sent/)).toBeVisible();

    await page.getByRole("button", { name: "Mark paid" }).click();
    await page.getByRole("button", { name: "Mark paid anyway" }).click();
    await expect(page.getByText(/marked paid/)).toBeVisible();

    const invoices = await readTable<InvoiceShape>(page, "invoices");
    expect(invoices.find((i) => i.serialNumber === serial)!.status).toBe("paid");
  });

  test("reopens a paid invoice back to sent", async ({ page }) => {
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.00" });

    await openInvoice(page, serial);
    await page.getByRole("button", { name: "Mark paid" }).click();
    await page.getByRole("button", { name: "Mark paid anyway" }).click();
    await expect(page.getByText(/marked paid/)).toBeVisible();

    await page.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByText(/marked sent/)).toBeVisible();

    const invoices = await readTable<InvoiceShape>(page, "invoices");
    expect(invoices.find((i) => i.serialNumber === serial)!.status).toBe("sent");
  });

  test("derives overdue from the due date rather than storing it", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
    });

    await page.goto("/invoices");
    await expect(page.getByText("Overdue").first()).toBeVisible();

    // Module 1 US-3: the stored status stays "sent"; overdue is computed at
    // display time, so it can never go stale.
    const invoices = await readTable<InvoiceShape>(page, "invoices");
    expect(invoices.find((i) => i.serialNumber === serial)!.status).toBe("sent");
  });
});

test.describe("invoice list", () => {
  test("searches by serial and by client name", async ({ page }) => {
    const acme = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.00" });
    await addInvoice(page, { clientName: "Globex GmbH", fxRate: "90.00" });

    await page.goto("/invoices");
    const search = page.getByPlaceholder("Search serial or client");

    await search.fill("Globex");
    await expect(page.getByText("Globex GmbH").first()).toBeVisible();
    await expect(page.getByText(acme, { exact: true })).toBeHidden();

    await search.fill(acme);
    await expect(page.getByText(acme, { exact: true }).first()).toBeVisible();

    await search.fill("no such invoice");
    await expect(page.getByText("No invoices match these filters.")).toBeVisible();
  });

  test("filters by status", async ({ page }) => {
    const draft = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      asDraft: true,
    });
    const sent = await addInvoice(page, { clientName: "Globex GmbH", fxRate: "90.00" });

    await page.goto("/invoices");
    await page.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: "draft" }).click();

    await expect(page.getByText(draft, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(sent, { exact: true })).toBeHidden();
  });

  test("filters by financial year", async ({ page }) => {
    const older = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      invoiceDate: "2026-03-31",
      dueDate: "2026-04-30",
    });
    const newer = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      invoiceDate: "2026-04-01",
      dueDate: "2026-05-01",
    });

    await page.goto("/invoices");
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "FY 2025-26" }).click();

    await expect(page.getByText(older, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(newer, { exact: true })).toBeHidden();
  });

  test("shows an empty state before any invoice exists", async ({ page }) => {
    await page.goto("/invoices");
    await expect(page.getByText("No invoices yet.")).toBeVisible();
  });
});

test.describe("dashboard", () => {
  test("reflects invoices and receivables live", async ({ page }) => {
    await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      quantity: "1",
      unitPrice: "1000",
    });

    await page.goto("/");
    await expect(page.getByText("Total Invoices")).toBeVisible();
    await expect(page.getByText("1 open invoice")).toBeVisible();
    // 1,000 USD at 83.00 = 83,000 INR outstanding.
    await expect(page.getByText("₹83,000.00")).toBeVisible();
    await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  });

  test("excludes drafts from pending receivables", async ({ page }) => {
    await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      unitPrice: "1000",
      asDraft: true,
    });

    await page.goto("/");
    await expect(page.getByText("0 open invoices")).toBeVisible();
  });

  test("lists overdue invoices", async ({ page }) => {
    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
    });

    await page.goto("/");
    await expect(page.getByText("Overdue invoices")).toBeVisible();
    await expect(page.getByText(serial, { exact: true })).toBeVisible();
  });
});
