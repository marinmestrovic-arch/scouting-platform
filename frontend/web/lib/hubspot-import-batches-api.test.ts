import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHubspotImportBatch,
  retryHubspotImportBatch,
} from "./hubspot-import-batches-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildBatchSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    run: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "July creators",
    },
    fileName: "july-creators.csv",
    schemaVersion: "week7-hubspot-import-v2",
    status: "queued",
    totalRowCount: 2,
    preparedRowCount: 0,
    failedRowCount: 0,
    syncedRowCount: 0,
    deliveryMode: "direct_object_api",
    lastError: null,
    requestedBy: {
      id: "33333333-3333-4333-8333-333333333333",
      email: "admin@example.com",
      name: "Admin",
    },
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("HubSpot import batch API helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the direct Object API delivery mode explicitly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildBatchSummary()),
    );

    await createHubspotImportBatch({
      runId: "22222222-2222-4222-8222-222222222222",
      deliveryMode: "direct_object_api",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/hubspot-import-batches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          runId: "22222222-2222-4222-8222-222222222222",
          deliveryMode: "direct_object_api",
        }),
      }),
    );
  });

  it("retries failed rows through the dedicated endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        batch: buildBatchSummary({ status: "queued", retryCount: 1 }),
        retriedRowCount: 1,
      }),
    );

    const result = await retryHubspotImportBatch("11111111-1111-4111-8111-111111111111");

    expect(result.retriedRowCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/hubspot-import-batches/11111111-1111-4111-8111-111111111111/retry",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ scope: "failed_rows" }),
      }),
    );
  });

  it("rejects an invalid retry response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ retriedRowCount: 0 }));

    await expect(
      retryHubspotImportBatch("11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow("Received an invalid HubSpot retry response.");
  });
});
