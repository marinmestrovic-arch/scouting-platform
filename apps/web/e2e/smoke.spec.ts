import { expect, test } from "@playwright/test";

test("homepage renders foundation confirmation", async ({ page }) => {
  await page.goto("/");

  const main = page.getByRole("main");
  await expect(main).toContainText("scouting-platform foundation setup is complete.");
});
