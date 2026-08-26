import {
  test,
  expect,
  addClient,
  addInvoice,
  completeEntityProfile,
  readTable,
  visibleSerial,
} from "./fixtures";

/**
 * Mobile layout (module 0, US-4). Runs only under the `mobile-chromium` project.
 *
 * The phone layout is a first-class target, not a shrunk desktop: it swaps the
 * sidebar for a bottom nav, the invoice table for cards, and the header button
 * for a thumb-reachable floating action.
 */

test.describe("mobile navigation", () => {
  test("uses a bottom nav instead of the desktop sidebar", async ({ page }) => {
    await page.goto("/");

    const bottomNav = page.getByRole("navigation").last();
    await expect(bottomNav).toBeVisible();

    // The bottom nav sits within thumb reach at the foot of the viewport.
    const box = (await bottomNav.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y + box.height).toBeGreaterThan(viewport.height - 5);

    await expect(bottomNav.getByRole("link", { name: "Invoices" })).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Clients" })).toBeVisible();
  });

  test("reaches secondary modules through the More sheet", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  });

  test("navigates between modules from the bottom nav", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("navigation").last().getByRole("link", { name: "Clients" }).click();
    await expect(page.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

    await page.getByRole("navigation").last().getByRole("link", { name: "Invoices" }).click();
    await expect(page.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible();
  });
});

test.describe("mobile primary actions", () => {
  test("offers a thumb-reachable floating action instead of a header button", async ({ page }) => {
    // Seed a client so the empty-state call to action is out of the way and only
    // the standing page actions remain.
    await addClient(page, { name: "Acme Inc", country: "United States" });
    await page.goto("/clients");

    // Exactly one "New client" affordance is exposed below the md breakpoint:
    // the header button is display:none, which also drops it from the
    // accessibility tree, so a role query cannot see it at all.
    const action = page.getByRole("button", { name: "New client" });
    await expect(action).toHaveCount(1);
    await expect(action).toBeVisible();

    // Within one thumb stretch: in the lower portion of the screen, clear of the
    // bottom edge, and at least a 44px touch target.
    const box = (await action.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y).toBeGreaterThan(viewport.height * 0.6);
    expect(box.y + box.height).toBeLessThan(viewport.height);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("creates a client from the floating action", async ({ page }) => {
    await addClient(page, { name: "Mobile Client Ltd", country: "Singapore" });

    const clients = await readTable<{ name: string }>(page, "clients");
    expect(clients.map((c) => c.name)).toContain("Mobile Client Ltd");
  });

  test("creates an invoice end to end on a phone viewport", async ({ page }) => {
    await completeEntityProfile(page);
    await addClient(page, { name: "Acme Inc", country: "United States", currency: "USD" });

    const serial = await addInvoice(page, {
      clientName: "Acme Inc",
      fxRate: "83.00",
      unitPrice: "1200",
    });

    await page.goto("/invoices");
    await expect(visibleSerial(page, serial)).toBeVisible();
  });
});

test.describe("mobile layout", () => {
  test("renders invoices as cards, not a horizontally scrolling table", async ({ page }) => {
    await completeEntityProfile(page);
    await addClient(page, { name: "Acme Inc", country: "United States", currency: "USD" });
    await addInvoice(page, { clientName: "Acme Inc", fxRate: "83.00" });

    await page.goto("/invoices");
    await expect(page.getByRole("table")).toBeHidden();

    // Module 5 US-2 / module 0 US-4: the body must never scroll sideways.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflows).toBe(false);
  });

  test("keeps search usable without horizontal scrolling", async ({ page }) => {
    await addClient(page, { name: "Acme Inc", country: "United States" });

    await page.goto("/clients");
    await page.getByPlaceholder("Search name, contact, or tax ID").fill("acme");
    await expect(page.getByText("Acme Inc")).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflows).toBe(false);
  });
});
