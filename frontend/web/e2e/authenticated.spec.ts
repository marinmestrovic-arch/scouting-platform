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

  test("dashboard opens the canonical HubSpot preparation workflow", async ({ page }) => {
    const seedData = readSeedData();

    await login(page, seedData.manager);
    await page.goto("/dashboard");

    const seededRunRow = page.locator("tr", { hasText: seedData.run.name });
    await expect(seededRunRow).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "HubSpot sync status" })).toBeVisible();
    await expect(seededRunRow.locator("td").nth(7).getByText("Completed", { exact: true }))
      .toBeVisible();

    const exportLink = seededRunRow.getByRole("link", { name: "HUBSPOT / EXPORT" });
    await expect(exportLink).toHaveAttribute("href", /\/exports\/prepare\/[0-9a-f-]+$/);
    await expect(exportLink).toHaveAttribute("target", "_blank");
  });

  test("catalog creator profile shows locally mirrored collaboration history", async ({ page }) => {
    const seedData = readSeedData();

    await login(page, seedData.manager);
    await page.goto(`/catalog/${seedData.channels.catalog.id}`);

    await expect(page.getByText("Worked with", { exact: true })).toBeVisible();
    await expect(page.getByText("Yes", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Collaboration History" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Week 8 E2E Creator Collaboration" }))
      .toHaveAttribute("href", /record\/0-3\/e2e-deal-1$/);
    await expect(page.getByText("Week 8 E2E Client", { exact: true })).toBeVisible();
    await expect(page.getByText("Week 8 E2E Campaign", { exact: true })).toBeVisible();
    await expect(page.getByText("Contract signed", { exact: true })).toBeVisible();
    await expect(page.getByText("Week 8 Deal Owner", { exact: true })).toBeVisible();
    await expect(page.getByText("Week 8 YouTube Integration", { exact: true })).toBeVisible();
  });

  test("prepared runs can exercise direct HubSpot sync with mocked local APIs", async ({ page }) => {
    const seedData = readSeedData();
    const batchId = "8c7c29b2-1780-4f21-9d84-fbf729b69ddb";
    const timestamp = "2026-07-20T10:00:00.000Z";
    const hubspotContactUrl = "https://app.hubspot.com/contacts/12345/record/0-1/101";
    const hubspotDealUrl = "https://app.hubspot.com/contacts/12345/record/0-3/202";
    const summary = {
      id: batchId,
      run: {
        id: seedData.run.id,
        name: seedData.run.name,
      },
      fileName: "week8-direct-sync.csv",
      schemaVersion: "week7-hubspot-import-v2",
      status: "completed",
      totalRowCount: 1,
      preparedRowCount: 1,
      failedRowCount: 0,
      syncedRowCount: 1,
      deliveryMode: "direct_object_api",
      portalId: "12345",
      lastError: null,
      requestedBy: {
        id: seedData.manager.id,
        email: seedData.manager.email,
        name: "Week 8 E2E Manager",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
    };
    const detail = {
      ...summary,
      rows: [
        {
          id: "cfcf2874-a4c2-4a2c-a784-49d3bcafab62",
          channelId: seedData.channels.catalog.id,
          channelTitle: seedData.channels.catalog.title,
          contactEmail: "creator@week8-e2e.example.com",
          firstName: "Week",
          lastName: "Eight",
          influencerType: seedData.channels.catalog.influencerType,
          influencerVertical: seedData.channels.catalog.influencerVertical,
          countryRegion: seedData.channels.catalog.countryRegion,
          language: "Croatian",
          status: "synced",
          errorMessage: null,
          hubspotContactId: "101",
          hubspotDealId: "202",
          hubspotContactUrl,
          hubspotDealUrl,
          associationStatus: "associated",
          retryable: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    };
    let directSyncRequests = 0;
    let submittedBody: unknown = null;

    await page.route("**/api/hubspot-readiness?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          ready: true,
          healthStatus: "healthy",
          portalId: "12345",
          blockers: [],
          activeBatchId: null,
        }),
      });
    });
    await page.route("**/api/hubspot-import-batches", async (route) => {
      if (route.request().method() === "POST") {
        directSyncRequests += 1;
        submittedBody = route.request().postDataJSON();
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify(summary),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      });
    });
    await page.route(`**/api/hubspot-import-batches/${batchId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(detail),
      });
    });

    await login(page, seedData.manager);
    await page.goto(`/exports/prepare/${seedData.run.id}`);

    const preparedRow = page.locator(".export-prep__table tbody tr").first();

    for (const [field, value] of [
      ["Currency", "EUR"],
      ["Deal Type", "Flat Fee"],
      ["Activation Type", "Organic"],
    ] as const) {
      await preparedRow.getByRole("button", { name: field }).click();
      await preparedRow.getByRole("option", { name: value, exact: true }).click();
    }

    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect(page.getByText("Edits saved.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Missing required values" })).toHaveCount(0);

    const syncButton = page.getByRole("button", { name: "Sync to HubSpot" });
    await expect(syncButton).toBeEnabled();
    await syncButton.click();

    await expect.poll(() => directSyncRequests).toBe(1);
    expect(submittedBody).toEqual({
      runId: seedData.run.id,
      deliveryMode: "direct_object_api",
    });
    await expect(page.getByRole("heading", { name: "Completed" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact" })).toHaveAttribute(
      "href",
      hubspotContactUrl,
    );
    await expect(page.getByRole("link", { name: "Deal" })).toHaveAttribute(
      "href",
      hubspotDealUrl,
    );
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

  test("admin surface exposes CSV Imports, Users, and Exports tabs", async ({ page }) => {
    const seedData = readSeedData();

    await login(page, seedData.admin);
    await page.goto("/admin");

    await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "CSV Imports" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Users" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Exports" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "HubSpot" })).toHaveCount(0);
    await expect(page.getByText("Approvals")).toHaveCount(0);

    await page.getByRole("tab", { name: "Exports" }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Exports workspace" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open /exports" })).toBeVisible();

    await page.goto("/admin?tab=hubspot");
    await expect(page.getByRole("button", { name: "Upload batch" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open /hubspot" })).toHaveCount(0);

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
