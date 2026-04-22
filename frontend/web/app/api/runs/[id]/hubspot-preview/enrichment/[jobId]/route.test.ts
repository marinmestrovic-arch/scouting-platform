import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getHubspotPreviewEnrichmentJobMock,
  requireAuthenticatedSessionMock,
  toRouteErrorResponseMock,
} = vi.hoisted(() => ({
  getHubspotPreviewEnrichmentJobMock: vi.fn(),
  requireAuthenticatedSessionMock: vi.fn(),
  toRouteErrorResponseMock: vi.fn((error: unknown) =>
    NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )),
}));

vi.mock("@scouting-platform/core", async () => {
  const actual = await vi.importActual<typeof import("@scouting-platform/core")>(
    "@scouting-platform/core",
  );

  return {
    ...actual,
    getHubspotPreviewEnrichmentJob: getHubspotPreviewEnrichmentJobMock,
  };
});

vi.mock("../../../../../../../lib/api", () => ({
  requireAuthenticatedSession: requireAuthenticatedSessionMock,
  toRouteErrorResponse: toRouteErrorResponseMock,
}));

import { GET } from "./route";

describe("hubspot preview enrichment status route", () => {
  beforeEach(() => {
    getHubspotPreviewEnrichmentJobMock.mockReset();
    requireAuthenticatedSessionMock.mockReset();
    toRouteErrorResponseMock.mockClear();
  });

  it("returns the durable Creator List enrichment job status", async () => {
    requireAuthenticatedSessionMock.mockResolvedValue({
      ok: true,
      userId: "user-1",
      role: "user",
    });
    getHubspotPreviewEnrichmentJobMock.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      runId: "7c5ca8f3-cd0d-42db-b4db-b863bdc3e821",
      status: "running",
      progressPercentage: 42,
      progressMessage: "Refreshing creator signals...",
      processedChannelCount: 1,
      updatedRowCount: 0,
      updatedFieldCount: 0,
      failedChannelCount: 0,
      lastError: null,
      createdAt: "2026-04-21T10:00:00.000Z",
      startedAt: "2026-04-21T10:00:01.000Z",
      completedAt: null,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/runs/7c5ca8f3-cd0d-42db-b4db-b863bdc3e821/hubspot-preview/enrichment/11111111-1111-4111-8111-111111111111",
      ),
      {
        params: Promise.resolve({
          id: "7c5ca8f3-cd0d-42db-b4db-b863bdc3e821",
          jobId: "11111111-1111-4111-8111-111111111111",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "running",
        progressPercentage: 42,
      },
    });
    expect(getHubspotPreviewEnrichmentJobMock).toHaveBeenCalledWith({
      runId: "7c5ca8f3-cd0d-42db-b4db-b863bdc3e821",
      enrichmentJobId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      role: "user",
    });
  });
});
