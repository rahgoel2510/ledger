import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;

/**
 * E2E config for VrikshaFX.
 *
 * Tests run against `next dev` rather than a served `out/` build: the app is a
 * pure client-side PWA, so the dev server and the static export render the same
 * tree, and dev avoids the production `basePath: '/vrikshafx'` that would
 * otherwise have to be threaded through every navigation in the suite.
 *
 * Workers are pinned to 1. Every spec drives the same origin's IndexedDB, and
 * parallel workers sharing it would see each other's invoices and clients.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      // The mobile specs assert on the bottom nav and floating action, neither
      // of which exists above the md breakpoint.
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      // Module 0 US-4 makes mobile a first-class layout, not a shrunk desktop —
      // the bottom nav and FAB only exist below the md breakpoint.
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],

  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
