import { test, expect } from "./fixtures";

test("dashboard live query resolves", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("/");
  await page.waitForTimeout(4000);
  console.log("---- CONSOLE ----\n" + errors.join("\n---\n"));
  await expect(page.getByText(/Invoices will print with/)).toBeVisible({ timeout: 5000 });
});
