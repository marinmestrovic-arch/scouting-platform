import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requestBulkChannelLlmEnrichmentMock,
  requireAuthenticatedSessionMock,
  toRouteErrorResponseMock,
} = vi.hoisted(() => ({
  requestBulkChannelLlmEnrichmentMock: vi.fn(),
  requireAuthenticatedSessionMock: vi.fn(),
  toRouteErrorResponseMock: vi.fn((error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : "error" }, { status: 500 }),
  ),
}));

vi.mock("@scouting-platform/core", () => ({
  requestBulkChannelLlmEnrichment: requestBulkChannelLlmEnrichmentMock,
}));

vi.mock("../../../../../lib/api", () => ({
  requireAuthenticatedSession: requireAuthenticatedSessionMock,
  toRouteErrorResponse: toRouteErrorResponseMock,
}));

import { POST } from "./route";

const userId = "11111111-1111-4111-8111-111111111111";

describe("channel enrichment bulk retry route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedSessionMock.mockResolvedValue({
      ok: true,
      userId,
    });
  });

  it("queues enrichment for channels matching catalog filters", async () => {
    requestBulkChannelLlmEnrichmentMock.mockResolvedValue({
      requestedCount: 3,
      queuedCount: 2,
      alreadyQueuedCount: 1,
      failedCount: 0,
    });

    const response = await POST(
      new Request("http://localhost/api/channels/enrichment/bulk-retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "filtered",
          filters: {
            query: "space",
            countryRegion: ["Croatia"],
          },
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      requestedCount: 3,
      queuedCount: 2,
      alreadyQueuedCount: 1,
      failedCount: 0,
    });
    expect(requestBulkChannelLlmEnrichmentMock).toHaveBeenCalledWith({
      requestedByUserId: userId,
      filters: {
        query: "space",
        countryRegion: ["Croatia"],
      },
    });
  });

  it("rejects unauthenticated requests before parsing the payload", async () => {
    const unauthorizedResponse = Response.json({ error: "Unauthorized" }, { status: 401 });

    requireAuthenticatedSessionMock.mockResolvedValue({
      ok: false,
      response: unauthorizedResponse,
    });

    const response = await POST(
      new Request("http://localhost/api/channels/enrichment/bulk-retry", {
        method: "POST",
        body: "not-json",
      }),
    );

    expect(response.status).toBe(401);
    expect(requestBulkChannelLlmEnrichmentMock).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/channels/enrichment/bulk-retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "filtered",
          filters: {
            youtubeFollowersMin: 1000,
            youtubeFollowersMax: 10,
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: "Invalid request payload",
      }),
    );
    expect(requestBulkChannelLlmEnrichmentMock).not.toHaveBeenCalled();
  });
});
