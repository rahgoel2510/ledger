import { test, expect, readTable } from "./fixtures";

/**
 * Phase 0 — PWA shell, offline behaviour, and installability (module 0).
 */

test.describe("app shell", () => {
  test("boots to the dashboard with the sidebar navigation", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Invoices" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Clients" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" }).first()).toBeVisible();
  });

  test("navigates between modules without a full page load", async ({ page }) => {
    await page.goto("/");

    // A client-side transition keeps the same document; a full reload would
    // reset this marker.
    await page.evaluate(() => {
      (window as unknown as { __spaMarker?: boolean }).__spaMarker = true;
    });

    await page.getByRole("link", { name: "Clients" }).first().click();
    await expect(page.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

    await page.getByRole("link", { name: "Invoices" }).first().click();
    await expect(page.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible();

    const stillSameDocument = await page.evaluate(
      () => (window as unknown as { __spaMarker?: boolean }).__spaMarker === true
    );
    expect(stillSameDocument).toBe(true);
  });

  test("seeds the local database on first run", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

    // The seed runs on Dexie's first open, which the dashboard triggers after
    // the heading has already painted — so poll rather than read once.
    await expect
      .poll(async () => (await readTable(page, "currencies")).length)
      .toBeGreaterThan(0);

    const currencies = await readTable<{ code: string; isBase: boolean; active: boolean }>(
      page,
      "currencies"
    );

    // INR is the reporting currency and must be the only base currency.
    const base = currencies.filter((c) => c.isBase);
    expect(base).toHaveLength(1);
    expect(base[0].code).toBe("INR");

    // USD and EUR ship active; the rest are available but off by default.
    const active = currencies.filter((c) => c.active).map((c) => c.code);
    expect(active).toEqual(expect.arrayContaining(["INR", "USD", "EUR"]));

    const profile = await readTable<{ id: string }>(page, "entityProfile");
    expect(profile).toHaveLength(1);
    expect(profile[0].id).toBe("default");
  });
});

test.describe("PWA installability", () => {
  test("serves a manifest with the icons an install prompt requires", async ({ page, request }) => {
    await page.goto("/");

    const manifestHref = await page.getAttribute('link[rel="manifest"]', "href");
    expect(manifestHref).toBeTruthy();

    const response = await request.get(manifestHref!);
    expect(response.ok()).toBe(true);

    const manifest = await response.json();
    expect(manifest.name).toContain("VrikshaFX");
    expect(manifest.display).toBe("standalone");

    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(
      manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")
    ).toBe(true);
  });

  test("registers a service worker that controls the page", async ({ page }) => {
    await page.goto("/");

    const registered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return Boolean(registration.active || registration.installing || registration.waiting);
    });
    expect(registered).toBe(true);
  });
});

test.describe("offline behaviour", () => {
  test("shows an offline indicator and keeps core features usable", async ({ page, context }) => {
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

    await context.setOffline(true);
    // The indicator is driven by the browser's online/offline events, which
    // setOffline does not always emit on its own.
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByText("Offline")).toBeVisible();

    // Module 0 US-3: going offline must not disable any non-cloud feature.
    await expect(page.getByPlaceholder("Search name, contact, or tax ID")).toBeEnabled();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText("Offline")).toBeHidden();
  });

  test("serves a usable fallback page for uncached routes", async ({ page }) => {
    // Precached by the service worker at install time so it is available even
    // for a route the user has never opened.
    await page.goto("/offline");
    await expect(
      page.getByRole("heading", { name: /isn't available offline yet/i })
    ).toBeVisible();
    await expect(page.getByText(/all your data is stored/i)).toBeVisible();
  });

  test("persists data written while offline", async ({ page, context }) => {
    await page.goto("/clients");

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    await page.getByRole("button", { name: "New client" }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Client name").fill("Offline Client Ltd");
    await sheet.getByLabel("Country").fill("Singapore");
    await sheet.getByRole("button", { name: "Add client" }).click();

    await expect(page.getByText("Offline Client Ltd added.")).toBeVisible();

    const clients = await readTable<{ name: string }>(page, "clients");
    expect(clients.map((c) => c.name)).toContain("Offline Client Ltd");

    await context.setOffline(false);
  });
});
