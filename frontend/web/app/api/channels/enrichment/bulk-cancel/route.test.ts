import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cancelBulkChannelLlmEnrichmentMock,
  requireAuthenticatedSessionMock,
} = vi.hoisted(() => ({
  cancelBulkChannelLlmEnrichmentMock: vi.fn(),
  requireAuthenticatedSessionMock: vi.fn(),
}));

vi.mock("@scouting-platform/core", () => ({
  cancelBulkChannelLlmEnrichment: cancelBulkChannelLlmEnrichmentMock,
}));

vi.mock("../../../../../lib/api", () => ({
  requireAuthenticatedSession: requireAuthenticatedSessionMock,
  toRouteErrorResponse: (error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : "error" }, { status: 500 }),
}));

import { POST } from "./route";

const userId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";

describe("channel enrichment bulk cancel route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedSessionMock.mockResolvedValue({ ok: true, userId });
    cancelBulkChannelLlmEnrichmentMock.mockResolvedValue({
      requestedCount: 1,
      cancelledCount: 1,
      notActiveCount: 0,
    });
  });

  it("cancels selected enrichments", async () => {
    const response = await POST(new Request(
      "http://localhost/api/channels/enrichment/bulk-cancel",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "selected", channelIds: [channelId] }),
      },
    ));

    expect(response.status).toBe(200);
    expect(cancelBulkChannelLlmEnrichmentMock).toHaveBeenCalledWith({
      actorUserId: userId,
      scope: { type: "selected", channelIds: [channelId] },
    });
  });

  it("rejects unauthenticated requests before parsing", async () => {
    requireAuthenticatedSessionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(new Request(
      "http://localhost/api/channels/enrichment/bulk-cancel",
      { method: "POST", body: "not-json" },
    ));

    expect(response.status).toBe(401);
    expect(cancelBulkChannelLlmEnrichmentMock).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads", async () => {
    const response = await POST(new Request(
      "http://localhost/api/channels/enrichment/bulk-cancel",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "selected", channelIds: ["invalid"] }),
      },
    ));

    expect(response.status).toBe(400);
    expect(cancelBulkChannelLlmEnrichmentMock).not.toHaveBeenCalled();
  });
});
