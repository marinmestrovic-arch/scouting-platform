import { expect, test } from "@playwright/test";

test("homepage redirects unauthenticated visitors to the login page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Scouting Platform" })).toBeVisible();
  await expect(page.getByText("Sign in to start a scouting run.")).toBeVisible();
});

test("login page renders the production sign-in form", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { level: 1, name: "Scouting Platform" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("authenticated routes redirect unauthenticated users to login", async ({ page }) => {
  const response = await page.goto("/dashboard");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Scouting Platform" })).toBeVisible();
  await expect(page.getByText("Sign in to start a scouting run.")).toBeVisible();
});
