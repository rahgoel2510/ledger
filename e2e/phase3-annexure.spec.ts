import {
  test,
  expect,
  readTable,
  completeEntityProfile,
  openPrimaryAction,
  openInvoice,
} from "./fixtures";

/**
 * Phase 3 — itemised task breakdowns, printed as Annexure A.
 *
 * A billed line can be broken into dated tasks. The invoice face then carries a
 * single figure for that line and the tasks travel on a second PDF page, which is
 * the shape a consultancy invoice usually takes.
 *
 * The rule worth guarding is arithmetic, not layout: an itemised line is billed
 * on the sum of its tasks. If the stored quantity could drift from the rows
 * printed beneath it, the client's own copy would show a total that does not add
 * up — so the sum is asserted against the store as well as the screen.
 */

interface AnnexedInvoiceShape {
  id: string;
  serialNumber: string;
  status: string;
  currency: string;
  billingModel: string;
  lineItems: {
    id: string;
    date?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    unit: string;
    tasks?: { id: string; date: string; description: string; hours: number }[];
  }[];
}

/** Adds an hourly client through the sheet, which is what drives the invoice editor's defaults. */
async function addHourlyClient(
  page: import("@playwright/test").Page,
  name: string,
  hourlyRate: string
): Promise<void> {
  await page.goto("/clients");
  await openPrimaryAction(page, "New client");
  const sheet = page.getByRole("dialog");

  await sheet.getByLabel("Client name").fill(name);
  await sheet.getByLabel("Country").fill("United States");
  await sheet.getByLabel("Default currency").click();
  await page.getByRole("option", { name: /^USD\b/ }).click();

  await sheet.getByRole("tab", { name: "Billing" }).click();
  await sheet.getByLabel("Rate per hour").fill(hourlyRate);

  await sheet.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByText(`${name} added.`)).toBeVisible();
}

/** Opens the invoice sheet on a client billed by the hour, with the FX rate filled. */
async function openInvoiceSheet(page: import("@playwright/test").Page, clientName: string) {
  await page.goto("/invoices");
  await openPrimaryAction(page, "New invoice");
  const sheet = page.getByRole("dialog");

  await sheet.getByLabel("Client").click();
  await page.getByRole("option", { name: new RegExp(clientName) }).click();
  await sheet.getByLabel(/Exchange rate on invoice date/).fill("83");
  return sheet;
}

test.describe("itemised task breakdown", () => {
  test.beforeEach(async ({ page }) => {
    await completeEntityProfile(page);
    await addHourlyClient(page, "Northwind Labs", "150");
  });

  test("bills a line on the sum of its tasks and keeps every task dated", async ({ page }) => {
    const sheet = await openInvoiceSheet(page, "Northwind Labs");

    await sheet.getByLabel("Consultation").fill("Professional services rendered");

    // Before any task exists the breakdown is only an offer — the line is an
    // ordinary hourly line with its own date and hours.
    await expect(sheet.getByText("Task breakdown")).toBeVisible();
    await expect(sheet.getByLabel("Date", { exact: true })).toBeVisible();

    await sheet.getByRole("button", { name: "Add task" }).click();
    await sheet.getByLabel("Task date").fill("2027-04-01");
    await sheet.getByLabel("Task", { exact: true }).fill("Architecture review call");
    await sheet.getByLabel("Task hours").fill("2.5");

    await sheet.getByRole("button", { name: "Add task" }).click();
    // The date carries forward — tasks are logged in a batch, days after the fact.
    await expect(sheet.getByLabel("Task date").nth(1)).toHaveValue("2027-04-01");
    await sheet.getByLabel("Task date").nth(1).fill("2027-04-06");
    await sheet.getByLabel("Task", { exact: true }).nth(1).fill("Vendor API integration review");
    await sheet.getByLabel("Task hours").nth(1).fill("4");

    // Hours are summed from the breakdown, not typed, and the line surrenders
    // its own date once it covers more than one.
    await expect(sheet.getByLabel("Hours", { exact: true })).toHaveValue("6.5");
    await expect(sheet.getByLabel("Hours", { exact: true })).toHaveAttribute("readonly", "");
    await expect(sheet.getByText("Summed from the task breakdown.")).toBeVisible();
    await expect(sheet.getByLabel("Date", { exact: true })).toHaveCount(0);
    await expect(sheet.getByText("6.50 hrs · Annexure A")).toBeVisible();
    await expect(sheet.getByText("$975.00").first()).toBeVisible();

    await sheet.getByRole("button", { name: "Save & issue" }).click();
    await expect(page.getByText(/issued\.$/)).toBeVisible();

    const invoices = await readTable<AnnexedInvoiceShape>(page, "invoices");
    expect(invoices).toHaveLength(1);
    const [line] = invoices[0].lineItems;

    expect(line.description).toBe("Professional services rendered");
    expect(line.unit).toBe("hours");
    expect(line.unitPrice).toBe(150);
    // The stored quantity is the tasks' sum, so the invoice face can never
    // contradict the annexure printed under it.
    expect(line.quantity).toBe(6.5);
    // No date of its own: a single date on a line spanning two would name one
    // of them arbitrarily.
    expect(line.date).toBeUndefined();
    expect(line.tasks).toHaveLength(2);
    expect(line.tasks?.[0]).toMatchObject({
      date: "2027-04-01",
      description: "Architecture review call",
      hours: 2.5,
    });
    expect(line.tasks?.[1]).toMatchObject({ date: "2027-04-06", hours: 4 });
  });

  test("refuses a task with no date, and one with no hours", async ({ page }) => {
    const sheet = await openInvoiceSheet(page, "Northwind Labs");
    await sheet.getByLabel("Consultation").fill("Professional services rendered");

    await sheet.getByRole("button", { name: "Add task" }).click();
    await sheet.getByLabel("Task date").fill("");
    await sheet.getByLabel("Task", { exact: true }).fill("Undated block of hours");
    await sheet.getByLabel("Task hours").fill("");

    await sheet.getByRole("button", { name: "Save & issue" }).click();

    await expect(sheet.getByText("Required — every task is dated.")).toBeVisible();
    await expect(sheet.getByText("Must be greater than zero.").first()).toBeVisible();
    expect(await readTable(page, "invoices")).toHaveLength(0);
  });

  test("shows the breakdown on the invoice, and drops it when the last task goes", async ({
    page,
  }) => {
    const sheet = await openInvoiceSheet(page, "Northwind Labs");
    await sheet.getByLabel("Consultation").fill("Professional services rendered");

    await sheet.getByRole("button", { name: "Add task" }).click();
    await sheet.getByLabel("Task date").fill("2027-04-01");
    await sheet.getByLabel("Task", { exact: true }).fill("Architecture review call");
    await sheet.getByLabel("Task hours").fill("3");

    // Removing the only task hands the line back its own date and clears the
    // total the breakdown left behind — that figure is nobody's any more.
    await sheet.getByRole("button", { name: /Remove task 1 from line 1/ }).click();
    await expect(sheet.getByLabel("Date", { exact: true })).toBeVisible();
    await expect(sheet.getByLabel("Hours", { exact: true })).toHaveValue("");
    await expect(sheet.getByLabel("Hours", { exact: true })).not.toHaveAttribute("readonly", "");

    // Put it back, save, and check the detail sheet reads the same rows the PDF
    // prints as Annexure A.
    await sheet.getByRole("button", { name: "Add task" }).click();
    await sheet.getByLabel("Task date").fill("2027-04-01");
    await sheet.getByLabel("Task", { exact: true }).fill("Architecture review call");
    await sheet.getByLabel("Task hours").fill("3");
    await sheet.getByRole("button", { name: "Save & issue" }).click();
    await expect(page.getByText(/issued\.$/)).toBeVisible();

    const invoices = await readTable<AnnexedInvoiceShape>(page, "invoices");
    expect(invoices[0].lineItems[0].quantity).toBe(3);

    await openInvoice(page, invoices[0].serialNumber);
    const detail = page.getByRole("dialog");
    await expect(detail.getByText("3.00 hrs over 1 line")).toBeVisible();
    await expect(detail.getByText("Architecture review call")).toBeVisible();
    await expect(detail.getByText("3.00 hrs", { exact: true })).toBeVisible();
    await expect(detail.getByText("Prints as Annexure A on the invoice PDF.")).toBeVisible();
  });

  test("keeps a flat retainer line free of any breakdown", async ({ page }) => {
    const sheet = await openInvoiceSheet(page, "Northwind Labs");

    await sheet.getByRole("button", { name: "Add task" }).click();
    await sheet.getByLabel("Task date").fill("2027-04-01");
    await sheet.getByLabel("Task", { exact: true }).fill("Architecture review call");
    await sheet.getByLabel("Task hours").fill("3");

    // A flat line is a period, not time worked — switching drops the breakdown
    // rather than leaving hours attached to something billed as one amount.
    await sheet
      .getByRole("combobox")
      .filter({ hasText: /Itemised by date|Fixed amounts/ })
      .click();
    await page.getByRole("option", { name: "Fixed amounts" }).click();

    await expect(sheet.getByText("Task breakdown")).toHaveCount(0);
    await sheet.getByLabel("Description").fill("Consulting services — April 2027");
    await sheet.getByLabel("Qty").fill("1");
    await sheet.getByLabel(/^Rate \(/).fill("4000");
    await sheet.getByRole("button", { name: "Save & issue" }).click();
    await expect(page.getByText(/issued\.$/)).toBeVisible();

    const invoices = await readTable<AnnexedInvoiceShape>(page, "invoices");
    expect(invoices[0].lineItems[0].tasks).toBeUndefined();
    expect(invoices[0].lineItems[0].quantity).toBe(1);
  });

  test("carries an itemised line through an edit without losing its tasks", async ({ page }) => {
    const sheet = await openInvoiceSheet(page, "Northwind Labs");
    await sheet.getByLabel("Consultation").fill("Professional services rendered");
    await sheet.getByRole("button", { name: "Add task" }).click();
    await sheet.getByLabel("Task date").fill("2027-04-01");
    await sheet.getByLabel("Task", { exact: true }).fill("Architecture review call");
    await sheet.getByLabel("Task hours").fill("2.5");
    await sheet.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByText(/saved as draft\.$/)).toBeVisible();

    const before = await readTable<AnnexedInvoiceShape>(page, "invoices");
    await openInvoice(page, before[0].serialNumber);
    await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();

    const edit = page.getByRole("dialog");
    await expect(edit.getByLabel("Task hours")).toHaveValue("2.5");
    await expect(edit.getByLabel("Hours", { exact: true })).toHaveValue("2.5");

    await edit.getByRole("button", { name: "Add task" }).click();
    await edit.getByLabel("Task date").nth(1).fill("2027-04-08");
    await edit.getByLabel("Task", { exact: true }).nth(1).fill("Migration plan draft");
    await edit.getByLabel("Task hours").nth(1).fill("1.5");
    await expect(edit.getByLabel("Hours", { exact: true })).toHaveValue("4");

    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/saved\.$/)).toBeVisible();

    const after = await readTable<AnnexedInvoiceShape>(page, "invoices");
    expect(after[0].lineItems[0].tasks).toHaveLength(2);
    expect(after[0].lineItems[0].quantity).toBe(4);
  });
});
