import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminCsvImportsApiError,
  createAdminCsvImportBatch,
  fetchAdminCsvImportBatchDetail,
  fetchAdminCsvImportBatches,
} from "./admin-csv-imports-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function buildBatchSummaryPayload(overrides?: Record<string, unknown>) {
  return {
    id: "61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d",
    fileName: "contacts.csv",
    templateVersion: "v2",
    status: "queued",
    totalRowCount: 2,
    importedRowCount: 0,
    failedRowCount: 1,
    lastError: null,
    requestedBy: {
      id: "ee8827ee-53df-4eef-aa7b-67218ef25f91",
      email: "admin@example.com",
      name: "Admin",
    },
    createdAt: "2026-03-11T09:00:00.000Z",
    updatedAt: "2026-03-11T09:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function buildBatchDetailPayload(overrides?: Record<string, unknown>) {
  return {
    ...buildBatchSummaryPayload(),
    page: 1,
    pageSize: 100,
    rows: [
      {
        id: "afcdbdf7-cbb3-4947-8eef-2ff73b19b0b4",
        rowNumber: 2,
        status: "imported",
        youtubeChannelId: "UC-CSV-1",
        channelTitle: "Imported Creator",
        hubspotRecordId: "111",
        timestampImported: "2026-03-11T09:00:00.000Z",
        channelUrl: "https://www.youtube.com/channel/UC-CSV-1",
        campaignName: "Spring Campaign",
        dealOwner: "Owner",
        handoffStatus: "Ready",
        contactEmail: "creator@example.com",
        phoneNumber: null,
        currency: "EUR",
        dealType: "Paid",
        contactType: "Influencer",
        month: "March",
        year: "2026",
        clientName: "Client A",
        dealName: "Creator - Spring Campaign",
        activationName: "Creator - Spring Campaign",
        pipeline: "Sales Pipeline",
        dealStage: "Scouted",
        firstName: "Imported",
        lastName: "Creator",
        youtubeHandle: "@imported",
        youtubeUrl: "https://www.youtube.com/@imported",
        subscriberCount: "1000",
        viewCount: "20000",
        videoCount: "50",
        youtubeVideoMedianViews: "18000",
        youtubeShortsMedianViews: "12000",
        youtubeEngagementRate: "3.1",
        youtubeFollowers: "1000",
        instagramHandle: null,
        instagramUrl: null,
        instagramPostAverageViews: null,
        instagramReelAverageViews: null,
        instagramStory7DayAverageViews: null,
        instagramStory30DayAverageViews: null,
        instagramEngagementRate: null,
        instagramFollowers: null,
        tiktokHandle: null,
        tiktokUrl: null,
        tiktokAverageViews: null,
        tiktokEngagementRate: null,
        tiktokFollowers: null,
        twitchHandle: null,
        twitchUrl: null,
        twitchAverageViews: null,
        twitchEngagementRate: null,
        twitchFollowers: null,
        kickHandle: null,
        kickUrl: null,
        kickAverageViews: null,
        kickEngagementRate: null,
        kickFollowers: null,
        xHandle: null,
        xUrl: null,
        xAverageViews: null,
        xEngagementRate: null,
        xFollowers: null,
        notes: "Imported from ops sheet",
        sourceLabel: "ops",
        influencerType: "Male",
        influencerVertical: "Gaming",
        countryRegion: "Croatia",
        language: "Croatian",
        channelId: "58f68d7a-c916-4b13-8afa-61845e490463",
        errorMessage: null,
      },
    ],
    ...overrides,
  };
}

describe("admin csv imports api helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads import batches from GET /api/admin/csv-import-batches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [buildBatchSummaryPayload()],
      }),
    );

    const items = await fetchAdminCsvImportBatches();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/csv-import-batches",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(items).toEqual([expect.objectContaining({ fileName: "contacts.csv" })]);
  });

  it("loads batch detail with pagination query from GET /api/admin/csv-import-batches/:id", async () => {
    const batchId = "61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildBatchDetailPayload()),
    );

    const detail = await fetchAdminCsvImportBatchDetail(batchId, { page: 2 });

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/admin/csv-import-batches/${batchId}?page=2`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(detail.rows[0]?.channelTitle).toBe("Imported Creator");
  });

  it("uploads csv files with FormData via POST /api/admin/csv-import-batches", async () => {
    const file = new File(["header\nvalue"], "contacts.csv", {
      type: "text/csv",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildBatchSummaryPayload()),
    );

    const result = await createAdminCsvImportBatch(file);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/csv-import-batches",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      }),
    );
    expect(result.id).toBe("61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d");
  });

  it("surfaces authorization errors from the route layer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(fetchAdminCsvImportBatches()).rejects.toThrow(
      "You are not authorized to manage CSV imports.",
    );
  });

  it("preserves route error messages for upload failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "CSV header does not match the strict template",
        },
        400,
      ),
    );

    await expect(
      createAdminCsvImportBatch(
        new File(["header\nvalue"], "contacts.csv", {
          type: "text/csv",
        }),
      ),
    ).rejects.toMatchObject({
      message: "CSV header does not match the strict template",
      status: 400,
    } satisfies Partial<AdminCsvImportsApiError>);
  });

  it("rejects invalid list responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "missing-shape",
          },
        ],
      }),
    );

    await expect(fetchAdminCsvImportBatches()).rejects.toThrow(
      "Received an invalid CSV import list response.",
    );
  });

  it("rejects invalid detail responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: "61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d",
      }),
    );

    await expect(fetchAdminCsvImportBatchDetail("61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d")).rejects.toThrow(
      "Received an invalid CSV import detail response.",
    );
  });

  it("rejects invalid upload responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: "61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d",
      }),
    );

    await expect(
      createAdminCsvImportBatch(
        new File(["header\nvalue"], "contacts.csv", {
          type: "text/csv",
        }),
      ),
    ).rejects.toThrow("Received an invalid CSV import upload response.");
  });
});
