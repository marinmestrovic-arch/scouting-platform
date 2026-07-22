import { beforeEach, describe, expect, it, vi } from "vitest";

const { readinessMock, requireSessionMock } = vi.hoisted(() => ({
  readinessMock: vi.fn(),
  requireSessionMock: vi.fn(),
}));

vi.mock("@scouting-platform/core", () => ({
  getHubspotReadiness: readinessMock,
}));

vi.mock("../../../lib/api", () => ({
  requireAuthenticatedSession: requireSessionMock,
  toRouteErrorResponse: vi.fn(() => Response.json({ error: "failed" }, { status: 500 })),
}));

import { GET } from "./route";

describe("HubSpot run readiness route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({
      ok: true,
      userId: "33333333-3333-4333-8333-333333333333",
      userEmail: "manager@example.com",
      role: "user",
    });
    readinessMock.mockResolvedValue({
      enabled: true,
      ready: false,
      healthStatus: "degraded",
      portalId: "12345",
      blockers: ["Provision the contact unique-ID property."],
      activeBatchId: null,
    });
  });

  it("returns user-safe persisted readiness for an authorized run", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/hubspot-readiness?runId=22222222-2222-4222-8222-222222222222",
      ),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).blockers).toEqual([
      "Provision the contact unique-ID property.",
    ]);
    expect(readinessMock).toHaveBeenCalledWith({
      requestedByUserId: "33333333-3333-4333-8333-333333333333",
      role: "user",
      runId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("rejects an invalid run id before calling core", async () => {
    const response = await GET(
      new Request("http://localhost/api/hubspot-readiness?runId=not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(readinessMock).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    const denied = Response.json({ error: "Unauthorized" }, { status: 401 });
    requireSessionMock.mockResolvedValue({ ok: false, response: denied });

    await expect(
      GET(new Request("http://localhost/api/hubspot-readiness?runId=not-a-uuid")),
    ).resolves.toBe(denied);
    expect(readinessMock).not.toHaveBeenCalled();
  });
});
