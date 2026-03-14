import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HubspotPushBatchesApiError,
  createHubspotPushBatch,
  fetchHubspotPushBatches,
  fetchHubspotPushBatchDetail,
} from "./hubspot-push-batches-api";

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
    id: "fdd240f2-ef31-43fe-b1d2-a584951654a8",
    status: "queued",
    totalRowCount: 2,
    pushedRowCount: 0,
    failedRowCount: 0,
    lastError: null,
    requestedBy: {
      id: "8c1136b4-1c95-4e8c-aefe-0e58df0a39d5",
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

function buildBatchDetailPayload(overrides?: Record<string, unknown>) {
  return {
    ...buildBatchSummaryPayload(),
    scope: {
      channelIds: [
        "14e40450-71c2-4e0e-a160-b787d21843fd",
        "f3d0fbec-f8a0-40ad-8e19-2370c6b99083",
      ],
    },
    rows: [
      {
        id: "28ada809-e597-483e-9a7f-f568fc2f80dd",
        channelId: "14e40450-71c2-4e0e-a160-b787d21843fd",
        contactEmail: "creator@example.com",
        status: "pushed",
        hubspotObjectId: "hubspot-contact-1",
        errorMessage: null,
        createdAt: "2026-03-13T09:00:00.000Z",
        updatedAt: "2026-03-13T09:01:00.000Z",
      },
      {
        id: "7399dc95-9ab0-4526-abfa-5da78000b3ab",
        channelId: "f3d0fbec-f8a0-40ad-8e19-2370c6b99083",
        contactEmail: null,
        status: "failed",
        hubspotObjectId: null,
        errorMessage: "Channel has no contact email",
        createdAt: "2026-03-13T09:00:00.000Z",
        updatedAt: "2026-03-13T09:01:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("hubspot push batches api helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates push batches through POST /api/hubspot-push-batches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildBatchSummaryPayload()),
    );

    const batch = await createHubspotPushBatch({
      channelIds: ["14e40450-71c2-4e0e-a160-b787d21843fd"],
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/hubspot-push-batches",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    expect(batch.totalRowCount).toBe(2);
  });

  it("loads push batch history from GET /api/hubspot-push-batches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [
          buildBatchSummaryPayload(),
          buildBatchSummaryPayload({
            id: "5f4ced33-1238-4d17-a243-2305d2f12265",
            status: "completed",
            pushedRowCount: 2,
            completedAt: "2026-03-13T09:02:00.000Z",
          }),
        ],
      }),
    );

    const items = await fetchHubspotPushBatches();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/hubspot-push-batches",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(items).toHaveLength(2);
    expect(items[1]?.status).toBe("completed");
  });

  it("loads push batch detail from GET /api/hubspot-push-batches/:id", async () => {
    const batchId = "fdd240f2-ef31-43fe-b1d2-a584951654a8";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildBatchDetailPayload()),
    );

    const detail = await fetchHubspotPushBatchDetail(batchId);

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/hubspot-push-batches/${batchId}`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(detail.rows[1]?.errorMessage).toBe("Channel has no contact email");
  });

  it("normalizes authorization errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(fetchHubspotPushBatches()).rejects.toThrow(
      "You are not authorized to manage HubSpot pushes.",
    );
  });

  it("normalizes not found detail errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 404));

    await expect(
      fetchHubspotPushBatchDetail("fdd240f2-ef31-43fe-b1d2-a584951654a8"),
    ).rejects.toMatchObject({
      message: "HubSpot push batch not found.",
      status: 404,
    } satisfies Partial<HubspotPushBatchesApiError>);
  });

  it("preserves route error messages for create failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "At least one creator is required for HubSpot push.",
        },
        400,
      ),
    );

    await expect(
      createHubspotPushBatch({
        channelIds: ["14e40450-71c2-4e0e-a160-b787d21843fd"],
      }),
    ).rejects.toMatchObject({
      message: "At least one creator is required for HubSpot push.",
      status: 400,
    } satisfies Partial<HubspotPushBatchesApiError>);
  });

  it("rejects invalid create responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: "fdd240f2-ef31-43fe-b1d2-a584951654a8",
      }),
    );

    await expect(
      createHubspotPushBatch({
        channelIds: ["14e40450-71c2-4e0e-a160-b787d21843fd"],
      }),
    ).rejects.toThrow("Received an invalid HubSpot push creation response.");
  });

  it("rejects invalid detail responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: "fdd240f2-ef31-43fe-b1d2-a584951654a8",
      }),
    );

    await expect(
      fetchHubspotPushBatchDetail("fdd240f2-ef31-43fe-b1d2-a584951654a8"),
    ).rejects.toThrow("Received an invalid HubSpot push detail response.");
  });

  it("rejects invalid list responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [{ id: "fdd240f2-ef31-43fe-b1d2-a584951654a8" }],
      }),
    );

    await expect(fetchHubspotPushBatches()).rejects.toThrow(
      "Received an invalid HubSpot push history response.",
    );
  });
});
