import type {
  CsvExportBatchDetail,
  CsvExportBatchSummary,
} from "@scouting-platform/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CsvExportBatchesApiError,
  createCsvExportBatch,
  fetchCsvExportBatches,
  fetchCsvExportBatchDetail,
  getCsvExportBatchDownloadUrl,
} from "./csv-export-batches-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function buildBatchSummaryPayload(
  overrides?: Partial<CsvExportBatchSummary>,
): CsvExportBatchSummary {
  return {
    id: "99d39ccb-3cf5-4f09-a647-a0e1387d31cb",
    scopeType: "selected" as const,
    fileName: "creator-export.csv",
    schemaVersion: "v1",
    status: "queued" as const,
    rowCount: 0,
    lastError: null,
    requestedBy: {
      id: "58825d8b-f806-4480-b23d-b23773cde596",
      email: "manager@example.com",
      name: "Manager",
    },
    createdAt: "2026-03-13T09:00:00.000Z",
    updatedAt: "2026-03-13T09:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function buildBatchDetailPayload(
  overrides?: Partial<CsvExportBatchDetail>,
): CsvExportBatchDetail {
  return {
    ...buildBatchSummaryPayload(),
    scope: {
      type: "selected" as const,
      channelIds: ["14e40450-71c2-4e0e-a160-b787d21843fd"],
    },
    ...overrides,
  };
}

describe("csv export batches api helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates selected export batches through POST /api/csv-export-batches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildBatchSummaryPayload()),
    );

    const batch = await createCsvExportBatch({
      type: "selected",
      channelIds: ["14e40450-71c2-4e0e-a160-b787d21843fd"],
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/csv-export-batches",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    expect(batch.fileName).toBe("creator-export.csv");
  });

  it("creates filtered export batches through POST /api/csv-export-batches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildBatchSummaryPayload({ scopeType: "filtered" })),
    );

    await createCsvExportBatch({
      type: "filtered",
      filters: {
        query: "space",
        enrichmentStatus: ["completed"],
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/csv-export-batches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "filtered",
          filters: {
            query: "space",
            enrichmentStatus: ["completed"],
          },
        }),
      }),
    );
  });

  it("loads export batch history from GET /api/csv-export-batches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [
          buildBatchSummaryPayload(),
          buildBatchSummaryPayload({
            id: "2e6ad364-f96d-4904-8407-f56f88bf2f3b",
            scopeType: "filtered",
            fileName: "space-creators.csv",
            status: "completed",
            rowCount: 12,
          }),
        ],
      }),
    );

    const items = await fetchCsvExportBatches();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/csv-export-batches",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(items).toHaveLength(2);
    expect(items[1]?.scopeType).toBe("filtered");
  });

  it("loads export batch detail from GET /api/csv-export-batches/:id", async () => {
    const batchId = "99d39ccb-3cf5-4f09-a647-a0e1387d31cb";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildBatchDetailPayload()),
    );

    const detail = await fetchCsvExportBatchDetail(batchId);

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/csv-export-batches/${batchId}`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(detail.scope).toEqual({
      type: "selected",
      channelIds: ["14e40450-71c2-4e0e-a160-b787d21843fd"],
    });
  });

  it("builds a download URL for completed export batches", () => {
    expect(
      getCsvExportBatchDownloadUrl("99d39ccb-3cf5-4f09-a647-a0e1387d31cb"),
    ).toBe("/api/csv-export-batches/99d39ccb-3cf5-4f09-a647-a0e1387d31cb/download");
  });

  it("normalizes authorization errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(
      createCsvExportBatch({
        type: "selected",
        channelIds: ["14e40450-71c2-4e0e-a160-b787d21843fd"],
      }),
    ).rejects.toThrow("You are not authorized to manage CSV exports.");
  });

  it("normalizes authorization errors for history requests", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(fetchCsvExportBatches()).rejects.toThrow(
      "You are not authorized to manage CSV exports.",
    );
  });

  it("normalizes not found detail errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 404));

    await expect(
      fetchCsvExportBatchDetail("99d39ccb-3cf5-4f09-a647-a0e1387d31cb"),
    ).rejects.toMatchObject({
      message: "CSV export batch not found.",
      status: 404,
    } satisfies Partial<CsvExportBatchesApiError>);
  });

  it("preserves route error messages for create failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Selected channels are required for export.",
        },
        400,
      ),
    );

    await expect(
      createCsvExportBatch({
        type: "selected",
        channelIds: ["14e40450-71c2-4e0e-a160-b787d21843fd"],
      }),
    ).rejects.toMatchObject({
      message: "Selected channels are required for export.",
      status: 400,
    } satisfies Partial<CsvExportBatchesApiError>);
  });

  it("rejects invalid create responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: "99d39ccb-3cf5-4f09-a647-a0e1387d31cb",
      }),
    );

    await expect(
      createCsvExportBatch({
        type: "selected",
        channelIds: ["14e40450-71c2-4e0e-a160-b787d21843fd"],
      }),
    ).rejects.toThrow("Received an invalid CSV export creation response.");
  });

  it("rejects invalid detail responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: "99d39ccb-3cf5-4f09-a647-a0e1387d31cb",
      }),
    );

    await expect(
      fetchCsvExportBatchDetail("99d39ccb-3cf5-4f09-a647-a0e1387d31cb"),
    ).rejects.toThrow("Received an invalid CSV export detail response.");
  });

  it("rejects invalid list responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "99d39ccb-3cf5-4f09-a647-a0e1387d31cb",
          },
        ],
      }),
    );

    await expect(fetchCsvExportBatches()).rejects.toThrow(
      "Received an invalid CSV export list response.",
    );
  });
});
