import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getHubspotHealthStateMock,
  requireAdminSessionMock,
  requestHubspotHealthCheckMock,
  toRouteErrorResponseMock,
} = vi.hoisted(() => ({
  getHubspotHealthStateMock: vi.fn(),
  requireAdminSessionMock: vi.fn(),
  requestHubspotHealthCheckMock: vi.fn(),
  toRouteErrorResponseMock: vi.fn((error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "error" },
      { status: 500 },
    ),
  ),
}));

vi.mock("@scouting-platform/core", () => ({
  getHubspotHealthState: getHubspotHealthStateMock,
  requestHubspotHealthCheck: requestHubspotHealthCheckMock,
}));

vi.mock("../../../../lib/api", () => ({
  requireAdminSession: requireAdminSessionMock,
  toRouteErrorResponse: toRouteErrorResponseMock,
}));

import { GET, POST } from "./route";

const requestedByUserId = "22222222-2222-4222-8222-222222222222";

const healthReport = {
  status: "healthy",
  portalId: "12345678",
  displayName: "Scouting Platform",
  directSyncEnabled: true,
  webhooksEnabled: true,
  checkedAt: "2026-07-20T08:00:00.000Z",
  lastReferenceSyncAt: "2026-07-20T07:55:00.000Z",
  lastObjectSyncAt: "2026-07-20T07:50:00.000Z",
  lastWebhookProcessedAt: "2026-07-20T07:59:00.000Z",
  checks: [
    {
      code: "account",
      label: "HubSpot account",
      status: "pass",
      message: "Connected to the expected HubSpot account.",
    },
  ],
  blockers: [],
  requiredActions: [],
  lastError: null,
  latestRun: null,
};

describe("database hubspot health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSessionMock.mockResolvedValue({
      ok: true,
      userId: requestedByUserId,
    });
  });

  it("returns the latest health report for admins", async () => {
    getHubspotHealthStateMock.mockResolvedValue(healthReport);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(healthReport);
    expect(getHubspotHealthStateMock).toHaveBeenCalledWith({
      requestedByUserId,
    });
    expect(requestHubspotHealthCheckMock).not.toHaveBeenCalled();
  });

  it("queues a durable health check for admins", async () => {
    const queuedState = {
      ...healthReport,
      latestRun: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "queued",
        queuedAt: "2026-07-20T08:05:00.000Z",
        startedAt: null,
        completedAt: null,
        lastError: null,
      },
    };
    requestHubspotHealthCheckMock.mockResolvedValue(queuedState);

    const response = await POST();

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(queuedState);
    expect(requestHubspotHealthCheckMock).toHaveBeenCalledWith({
      requestedByUserId,
    });
    expect(getHubspotHealthStateMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated GET requests without reading health", async () => {
    const authResponse = Response.json({ error: "Unauthorized" }, { status: 401 });
    requireAdminSessionMock.mockResolvedValue({
      ok: false,
      response: authResponse,
    });

    await expect(GET()).resolves.toBe(authResponse);
    expect(getHubspotHealthStateMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated POST requests without running a check", async () => {
    const authResponse = Response.json({ error: "Unauthorized" }, { status: 401 });
    requireAdminSessionMock.mockResolvedValue({
      ok: false,
      response: authResponse,
    });

    await expect(POST()).resolves.toBe(authResponse);
    expect(requestHubspotHealthCheckMock).not.toHaveBeenCalled();
  });

  it("maps service failures through the shared route error handler", async () => {
    const error = new Error("HubSpot is unavailable");
    requestHubspotHealthCheckMock.mockRejectedValue(error);

    const response = await POST();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "HubSpot is unavailable" });
    expect(toRouteErrorResponseMock).toHaveBeenCalledWith(error);
  });
});
