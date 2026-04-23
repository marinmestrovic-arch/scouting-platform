import fs from "node:fs";

import { CSV_IMPORT_HEADER } from "@scouting-platform/contracts";
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

function createCreatorListCsvRow(overrides: Partial<Record<(typeof CSV_IMPORT_HEADER)[number], string>>): string {
  return CSV_IMPORT_HEADER.map((header) => overrides[header] ?? "").join(",");
}

test.describe("authenticated launch-readiness flows", () => {
  test.describe.configure({ mode: "serial" });

  test("dashboard exposes only the Export handoff action for runs", async ({ page }) => {
    const seedData = readSeedData();

    await login(page, seedData.manager);
    await page.goto("/dashboard");

    const seededRunRow = page.locator("tr", { hasText: seedData.run.name });
    await expect(seededRunRow).toBeVisible();

    const exportLink = seededRunRow.getByRole("link", { name: "Export" });
    await expect(exportLink).toHaveAttribute("href", /\/hubspot\/prepare\/[0-9a-f-]+$/);
    await expect(exportLink).toHaveAttribute("target", "_blank");
  });

  test("catalog supports real creator and metric filters", async ({ page }) => {
    const seedData = readSeedData();
    const minVideoMedianViews = String(Number(seedData.channels.catalog.youtubeVideoMedianViews) - 1000);
    const maxVideoMedianViews = String(Number(seedData.channels.catalog.youtubeVideoMedianViews) + 1000);

    await login(page, seedData.manager);

    const url = new URL("/catalog", "http://localhost");
    url.searchParams.set("countryRegion", seedData.channels.catalog.countryRegion);
    url.searchParams.set("influencerVertical", seedData.channels.catalog.influencerVertical);
    url.searchParams.set("influencerType", seedData.channels.catalog.influencerType);
    url.searchParams.set("youtubeVideoMedianViewsMin", minVideoMedianViews);
    url.searchParams.set("youtubeVideoMedianViewsMax", maxVideoMedianViews);

    await page.goto(`${url.pathname}?${url.searchParams.toString()}`);

    await expect(page.getByRole("columnheader", { name: "Country/Region" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "YouTube Video Median Views" })).toBeVisible();
    await expect(page.getByRole("link", { name: seedData.channels.catalog.title })).toBeVisible();
    await expect(page.getByText("No channels found")).toHaveCount(0);
  });

  test("admin surface exposes CSV Imports, Users, Exports, and HubSpot tabs", async ({ page }) => {
    const seedData = readSeedData();

    await login(page, seedData.admin);
    await page.goto("/admin");

    await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "CSV Imports" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Users" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Exports" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "HubSpot" })).toBeVisible();
    await expect(page.getByText("Approvals")).toHaveCount(0);

    await page.getByRole("tab", { name: "Exports" }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Exports workspace" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open /exports" })).toBeVisible();

    await page.goto("/admin?tab=hubspot");
    await expect(page.getByRole("heading", { level: 3, name: "HubSpot workspace" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open /hubspot" })).toBeVisible();

    await page.goto("/admin?tab=imports");
    await expect(page.getByRole("button", { name: "Upload batch" })).toBeVisible();
  });

  test("admin can upload Creator List v3 CSV imports", async ({ page }) => {
    const seedData = readSeedData();
    const fileName = "week8-playwright-import-v3.csv";
    const youtubeChannelId = "UC1111111111111111111111";
    const csvFile = [
      CSV_IMPORT_HEADER.join(","),
      createCreatorListCsvRow({
        "Channel Name": "Week 8 Valid CSV Channel",
        "Channel URL": `https://www.youtube.com/channel/${youtubeChannelId}`,
        Email: "valid@example.com",
        "First Name": "Valid",
        "Last Name": "Row",
        "Influencer Type": seedData.channels.catalog.influencerType,
        "Influencer Vertical": seedData.channels.catalog.influencerVertical,
        "Country/Region": seedData.channels.catalog.countryRegion,
        Language: "Croatian",
        "YouTube Handle": "@week8csvimport",
        "YouTube URL": `https://www.youtube.com/channel/${youtubeChannelId}`,
        "YouTube Video Median Views": "120000",
        "YouTube Shorts Median Views": "45000",
        "YouTube Engagement Rate": "4.2",
        "YouTube Followers": "120000",
      }),
    ].join("\n");

    await login(page, seedData.admin);
    await page.goto("/admin?tab=imports");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "CSV file" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: "text/csv",
      buffer: Buffer.from(csvFile, "utf8"),
    });
    await page.getByRole("button", { name: "Upload batch" }).click();

    await expect(page.getByText(/CSV import queued\.|Import batch created\./)).toBeVisible();
    await expect(
      page
        .locator(".admin-csv-imports__list-item", {
          hasText: fileName,
        })
        .first(),
    ).toBeVisible();

    await page.getByRole("button", { name: fileName }).click();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: fileName,
      }),
    ).toBeVisible();
  });

  test("database HubSpot sync action can be exercised with a mocked API", async ({ page }) => {
    const seedData = readSeedData();

    const queuedRun = {
      id: "0d63aee0-df1a-4579-8b59-17e6baf6d04f",
      status: "queued",
      objectTypes: ["clients", "campaigns", "dropdownValues"],
      clientUpsertCount: 0,
      campaignUpsertCount: 0,
      deactivatedCount: 0,
      startedAt: null,
      completedAt: null,
      lastError: null,
      createdAt: "2026-04-22T10:00:00.000Z",
      updatedAt: "2026-04-22T10:00:00.000Z",
    };

    const completedRun = {
      ...queuedRun,
      status: "completed",
      clientUpsertCount: 3,
      campaignUpsertCount: 2,
      deactivatedCount: 1,
      completedAt: "2026-04-22T10:01:00.000Z",
      updatedAt: "2026-04-22T10:01:00.000Z",
    };

    let syncPostCalls = 0;

    await page.route("**/api/database/hubspot-sync", async (route) => {
      if (route.request().method() === "POST") {
        syncPostCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ run: queuedRun }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [completedRun], latest: completedRun }),
      });
    });

    await login(page, seedData.admin);
    await page.goto("/database");

    await expect(page.getByRole("button", { name: "Sync from HubSpot" })).toBeVisible();
    await page.getByRole("button", { name: "Sync from HubSpot" }).click();

    await expect(page.getByText("HubSpot sync queued.")).toBeVisible();
    await expect.poll(() => syncPostCalls).toBe(1);
  });
});
