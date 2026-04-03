import process from "node:process";

import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const CM_EMAIL = process.env.E2E_CM_EMAIL ?? "";
const CM_PASSWORD = process.env.E2E_CM_PASSWORD ?? "";

async function login(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test.describe("remote staging authenticated smoke", () => {
  test.describe.configure({ mode: "serial" });

  test("admin can sign in and reach dashboard", async ({ page }) => {
    await login(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  });

  test("admin can reach the admin panel", async ({ page }) => {
    await login(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();
  });

  test("campaign manager can sign in and reach dashboard", async ({ page }) => {
    await login(page, { email: CM_EMAIL, password: CM_PASSWORD });
  });

  test("campaign manager can reach new scouting page", async ({ page }) => {
    await login(page, { email: CM_EMAIL, password: CM_PASSWORD });
    await page.goto("/new-scouting");
    await expect(page.getByRole("heading", { level: 1, name: "New Scouting" })).toBeVisible();
  });

  test("campaign manager can reach catalog", async ({ page }) => {
    await login(page, { email: CM_EMAIL, password: CM_PASSWORD });
    await page.goto("/catalog");
    await expect(page.getByRole("heading", { level: 1, name: "Catalog" })).toBeVisible();
  });
});
