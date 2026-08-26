import {
  test,
  expect,
  readTable,
  addClient,
  addInvoice,
  completeEntityProfile,
  type AuditEntryShape,
} from "./fixtures";

/**
 * Phase 1 — client directory (module 5).
 */

test.describe("client directory", () => {
  test("stores the full billing profile", async ({ page }) => {
    await addClient(page, {
      name: "Acme Inc",
      country: "United States",
      currency: "USD",
      taxId: "EIN 12-3456789",
      primaryContact: "jane@acme.example",
      billingAddress: "500 Market St\nSan Francisco, CA 94105",
    });

    const clients = await readTable<{
      name: string;
      country: string;
      defaultCurrency: string;
      taxId: string;
      primaryContact: string;
      billingAddress: string;
      archived: boolean;
    }>(page, "clients");

    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({
      name: "Acme Inc",
      country: "United States",
      defaultCurrency: "USD",
      taxId: "EIN 12-3456789",
      primaryContact: "jane@acme.example",
      archived: false,
    });
    expect(clients[0].billingAddress).toContain("San Francisco");
  });

  test("requires a name and country", async ({ page }) => {
    await page.goto("/clients");
    await page.getByRole("button", { name: "New client" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Add client" }).click();

    await expect(page.getByText("Required.").first()).toBeVisible();
    await expect(
      page.getByText("Required — drives the export-of-services treatment.")
    ).toBeVisible();
    expect(await readTable(page, "clients")).toHaveLength(0);
  });

  test("searches by name, contact, and tax ID", async ({ page }) => {
    await addClient(page, {
      name: "Acme Inc",
      country: "United States",
      primaryContact: "jane@acme.example",
    });
    await addClient(page, { name: "Globex GmbH", country: "Germany", taxId: "DE123456789" });

    await page.goto("/clients");
    const search = page.getByPlaceholder("Search name, contact, or tax ID");

    await search.fill("globex");
    await expect(page.getByText("Globex GmbH")).toBeVisible();
    await expect(page.getByText("Acme Inc")).toBeHidden();

    await search.fill("jane@acme");
    await expect(page.getByText("Acme Inc")).toBeVisible();
    await expect(page.getByText("Globex GmbH")).toBeHidden();

    await search.fill("DE1234");
    await expect(page.getByText("Globex GmbH")).toBeVisible();

    await search.fill("nothing matches this");
    await expect(page.getByText("No clients match this search.")).toBeVisible();
  });

  test("filters by country", async ({ page }) => {
    await addClient(page, { name: "Acme Inc", country: "United States" });
    await addClient(page, { name: "Globex GmbH", country: "Germany" });

    await page.goto("/clients");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Germany" }).click();

    await expect(page.getByText("Globex GmbH")).toBeVisible();
    await expect(page.getByText("Acme Inc")).toBeHidden();
  });

  test("edits a client without altering invoices already issued to them", async ({ page }) => {
    await completeEntityProfile(page);
    await addClient(page, {
      name: "Acme Inc",
      country: "United States",
      billingAddress: "500 Market St",
    });
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.00" });

    await page.goto("/clients");
    await page.getByRole("button", { name: "Edit" }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Client name").fill("Acme Corporation");
    await sheet.getByLabel("Billing address").fill("1 New Address Way");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Acme Corporation updated.")).toBeVisible();

    // Module 5 US-1: the invoice keeps the snapshot taken at creation time, so a
    // corrected address never silently rewrites a PDF already sent to a client.
    const invoices = await readTable<{
      serialNumber: string;
      clientSnapshot: { name: string; billingAddress: string };
    }>(page, "invoices");
    const issued = invoices.find((i) => i.serialNumber === serial)!;
    expect(issued.clientSnapshot.name).toBe("Acme Inc");
    expect(issued.clientSnapshot.billingAddress).toBe("500 Market St");

    await page.goto("/invoices");
    await expect(page.getByText("Acme Inc").first()).toBeVisible();
  });

  test("archives rather than deletes a client that has invoices", async ({ page }) => {
    await completeEntityProfile(page);
    await addClient(page, { name: "Acme Inc", country: "United States" });
    // A second, untouched client keeps invoicing reachable afterwards — with
    // every client archived the app correctly refuses to start a new invoice.
    await addClient(page, { name: "Still Active Ltd", country: "Germany" });
    const serial = await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.00" });

    await page.goto("/clients");
    const acmeCard = page.locator('[data-slot="card"]').filter({ hasText: "Acme Inc" });
    await acmeCard.getByRole("button", { name: "Archive" }).click();

    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(/their invoices are untouched/)).toBeVisible();

    const clients = await readTable<{ name: string; archived: boolean }>(page, "clients");
    expect(clients).toHaveLength(2);
    expect(clients.find((c) => c.name === "Acme Inc")!.archived).toBe(true);

    // The historical invoice is untouched.
    await page.goto("/invoices");
    await expect(page.getByText(serial, { exact: true }).first()).toBeVisible();

    // ...but the client no longer clutters the new-invoice picker.
    await page.getByRole("button", { name: "New invoice" }).first().click();
    await page.getByRole("dialog").getByLabel("Client").click();
    await expect(page.getByRole("option", { name: /Still Active Ltd/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Acme Inc/ })).toBeHidden();
  });

  test("deletes outright a client that has no invoices, and logs it", async ({ page }) => {
    await addClient(page, { name: "Never Billed Ltd", country: "Singapore" });

    await page.goto("/clients");
    await page.getByRole("button", { name: "Archive" }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("Never Billed Ltd deleted.")).toBeVisible();

    expect(await readTable(page, "clients")).toHaveLength(0);

    const audit = await readTable<AuditEntryShape>(page, "auditLog");
    const entry = audit.find((e) => e.actionType === "client_archived");
    expect(entry!.summary).toContain("no invoices");
  });

  test("restores an archived client", async ({ page }) => {
    await completeEntityProfile(page);
    await addClient(page, { name: "Acme Inc", country: "United States" });
    await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.00" });

    await page.goto("/clients");
    await page.getByRole("button", { name: "Archive" }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();

    // Exact, so the badge is not confused with the "... archived ..." toast.
    await expect(page.getByText("Archived", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Archived", { exact: true })).toBeHidden();

    const clients = await readTable<{ archived: boolean }>(page, "clients");
    expect(clients[0].archived).toBe(false);
  });

  test("blocks invoicing until at least one client exists", async ({ page }) => {
    await completeEntityProfile(page);

    await page.goto("/invoices");
    await expect(page.getByText(/Add a client first/)).toBeVisible();
    await expect(page.getByRole("button", { name: "New invoice" }).first()).toBeDisabled();
  });
});
