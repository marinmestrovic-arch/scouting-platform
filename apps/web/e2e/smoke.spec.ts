import { expect, test } from "@playwright/test";

test("homepage renders foundation confirmation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Scouting Platform" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "The scouting workspace is available behind the authenticated app shell.",
  );
  await expect(
    page.getByRole("link", { name: "the new scouting dashboard" }),
  ).toHaveAttribute("href", "/dashboard");
});
