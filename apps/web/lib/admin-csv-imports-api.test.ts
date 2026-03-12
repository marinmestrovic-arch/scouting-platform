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
    templateVersion: "v1",
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
        contactEmail: "creator@example.com",
        subscriberCount: "1000",
        viewCount: "20000",
        videoCount: "50",
        notes: "Imported from ops sheet",
        sourceLabel: "ops",
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
