import { expect, test } from "@playwright/test";

test("homepage renders foundation confirmation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Scouting Platform" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Week 0 scaffold is ready.");
});
