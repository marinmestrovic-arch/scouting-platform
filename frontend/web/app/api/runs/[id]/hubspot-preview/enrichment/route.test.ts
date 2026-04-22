import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createHubspotPreviewEnrichmentJobMock,
  requireAuthenticatedSessionMock,
  toRouteErrorResponseMock,
} = vi.hoisted(() => ({
  createHubspotPreviewEnrichmentJobMock: vi.fn(),
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
    createHubspotPreviewEnrichmentJob: createHubspotPreviewEnrichmentJobMock,
  };
});

vi.mock("../../../../../../lib/api", () => ({
  requireAuthenticatedSession: requireAuthenticatedSessionMock,
  toRouteErrorResponse: toRouteErrorResponseMock,
}));

import { POST } from "./route";

describe("hubspot preview enrichment route", () => {
  beforeEach(() => {
    createHubspotPreviewEnrichmentJobMock.mockReset();
    requireAuthenticatedSessionMock.mockReset();
    toRouteErrorResponseMock.mockClear();
  });

  it("creates a durable Creator List enrichment job", async () => {
    requireAuthenticatedSessionMock.mockResolvedValue({
      ok: true,
      userId: "user-1",
      role: "user",
    });
    createHubspotPreviewEnrichmentJobMock.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      runId: "7c5ca8f3-cd0d-42db-b4db-b863bdc3e821",
      status: "queued",
      progressPercentage: 0,
      progressMessage: "Creator List enrichment queued.",
      processedChannelCount: 0,
      updatedRowCount: 0,
      updatedFieldCount: 0,
      failedChannelCount: 0,
      lastError: null,
      createdAt: "2026-04-21T10:00:00.000Z",
      startedAt: null,
      completedAt: null,
    });

    const response = await POST(
      new Request(
        "http://localhost/api/runs/7c5ca8f3-cd0d-42db-b4db-b863bdc3e821/hubspot-preview/enrichment",
        {
          method: "POST",
        },
      ),
      {
        params: Promise.resolve({
          id: "7c5ca8f3-cd0d-42db-b4db-b863bdc3e821",
        }),
      },
    );

    expect(response.status).toBe(202);

    await expect(response.json()).resolves.toMatchObject({
      job: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "queued",
      },
    });
    expect(createHubspotPreviewEnrichmentJobMock).toHaveBeenCalledWith({
      runId: "7c5ca8f3-cd0d-42db-b4db-b863bdc3e821",
      userId: "user-1",
      role: "user",
      actorUserId: "user-1",
    });
  });
});
