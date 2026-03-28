import fs from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { PLAYWRIGHT_SEED_PATH, type PlaywrightSeedData } from "./test-data";

function readSeedData(): PlaywrightSeedData {
  return JSON.parse(fs.readFileSync(PLAYWRIGHT_SEED_PATH, "utf8")) as PlaywrightSeedData;
}

async function login(page: Page, credentials: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function selectSearchableOption(
  page: Page,
  label: string,
  optionText: string,
): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("option", { name: optionText }).click();
}

test.describe("authenticated launch-readiness flows", () => {
  test.describe.configure({ mode: "serial" });

  test("campaign manager can create a run from the authenticated workspace", async ({ page }) => {
    const seedData = readSeedData();

    await login(page, seedData.manager);
    await page.goto("/new-scouting");

    await page.getByLabel("Influencer List").fill("Week 8 Playwright Run");
    await selectSearchableOption(page, "Campaign", seedData.campaign.name);
    await selectSearchableOption(page, "Campaign Manager", "Week 8 E2E Manager");
    await page.getByLabel("Target").fill("15");
    await page.getByLabel("Prompt").fill("Launch-ready gaming creators in Germany");
    await page.getByRole("button", { name: "Start scouting" }).click();

    await expect(page).toHaveURL(/\/runs\/.+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Run Detail" })).toBeVisible();
    await expect(page.getByText("Week 8 Playwright Run")).toBeVisible();
    await expect(page.locator(".run-detail__status--queued")).toBeVisible();
  });

  test("campaign manager can request enrichment and an advanced report from channel detail", async ({
    page,
  }) => {
    const seedData = readSeedData();

    await login(page, seedData.manager);
    await page.goto(`/catalog/${seedData.channels.catalog.id}`);

    await expect(page.getByText(seedData.channels.catalog.title)).toBeVisible();
    await page.getByRole("button", { name: "Enrichment: Missing" }).click();
    await page.getByRole("button", { name: "Enrich now" }).click();
    await expect(page.getByRole("button", { name: "Enrichment: Queued" })).toBeVisible();
    await page.getByRole("button", { name: "Advanced report: Missing" }).click();
    await page.getByRole("button", { name: "Request advanced report" }).click();
    await expect(page.getByRole("button", { name: "Advanced report: Pending Approval" })).toBeVisible();
  });

  test("admin can approve a pending advanced report request", async ({ page }) => {
    const seedData = readSeedData();

    await login(page, seedData.admin);
    await page.goto("/admin");

    await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();
    await expect(page.getByText(seedData.channels.approval.title)).toBeVisible();
    await page
      .locator("tr", {
        hasText: seedData.channels.approval.title,
      })
      .getByRole("button", { name: "Open details" })
      .click();
    await page.getByLabel("Decision note (optional)").fill("Approved during Week 8 launch readiness.");
    await page.getByRole("button", { name: "Approve" }).click();

    await expect(page.getByText("Approval recorded.")).toBeVisible();
    await expect(page.getByText("Approved")).toBeVisible();
  });

  test("admin can upload a CSV import batch and review visible row failures", async ({ page }) => {
    const seedData = readSeedData();
    const csvFile = [
      "youtubeChannelId,channelTitle,contactEmail,firstName,lastName,subscriberCount,viewCount,videoCount,notes,sourceLabel",
      "UCweek8e2ecsvvalid0000001,Week 8 Valid CSV Channel,valid@example.com,Valid,Row,1000,2000,30,Good row,Playwright",
    ].join("\n");

    await login(page, seedData.admin);
    await page.goto("/admin?tab=imports");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "CSV file" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "week8-playwright-import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvFile, "utf8"),
    });
    await page.getByRole("button", { name: "Upload batch" }).click();

    await expect(page.getByText("CSV import queued.")).toBeVisible();
    await expect(
      page
        .locator(".admin-csv-imports__list-item", {
          hasText: "week8-playwright-import.csv",
        })
        .getByText("Queued"),
    ).toBeVisible();

    await page.getByRole("button", { name: seedData.batches.csvImportFileName }).click();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: seedData.batches.csvImportFileName,
      }),
    ).toBeVisible();
    await expect(page.getByText("contactEmail is invalid")).toBeVisible();
  });

  test("campaign manager can create filtered exports and review HubSpot result history", async ({
    page,
  }) => {
    const seedData = readSeedData();

    await login(page, seedData.manager);
    await page.goto("/exports");

    await page.getByRole("searchbox", { name: "Search" }).fill(seedData.channels.catalog.title);
    await page.getByRole("button", { name: "Create filtered export" }).click();

    await expect(page.getByText("Filtered CSV export queued.")).toBeVisible();
    await expect(
      page
        .locator(".csv-export__list-item", {
          hasText: seedData.batches.csvExportFileName,
        })
        .getByRole("link", { name: "Download CSV" }),
    ).toBeVisible();

    await page.goto("/hubspot");
    await expect(page.getByRole("heading", { level: 1, name: "HubSpot" })).toBeVisible();
    await expect(page.getByText(seedData.batches.hubspotRunName)).toBeVisible();
    await page
      .locator("button.hubspot-push__list-item", {
        hasText: seedData.batches.hubspotRunName,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: seedData.batches.hubspotRunName,
      }),
    ).toBeVisible();
    await expect(page.getByText(seedData.batches.hubspotImportFileName)).toBeVisible();
    await expect(
      page.locator(".hubspot-push__detail-actions").getByRole("link", { name: "Download CSV" }),
    ).toBeVisible();
  });
});
