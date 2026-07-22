import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, retryMock, routeErrorMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  retryMock: vi.fn(),
  routeErrorMock: vi.fn(() => Response.json({ error: "failed" }, { status: 500 })),
}));

vi.mock("@scouting-platform/core", () => ({
  retryHubspotImportBatch: retryMock,
}));

vi.mock("../../../../../lib/api", () => ({
  requireAuthenticatedSession: requireSessionMock,
  toRouteErrorResponse: routeErrorMock,
}));

import { POST } from "./route";

const batch = {
  id: "11111111-1111-4111-8111-111111111111",
  run: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "July creators",
  },
  fileName: "july-creators.csv",
  schemaVersion: "week7-hubspot-import-v2",
  status: "queued",
  totalRowCount: 2,
  preparedRowCount: 1,
  failedRowCount: 1,
  syncedRowCount: 1,
  deliveryMode: "direct_object_api",
  lastError: null,
  requestedBy: {
    id: "33333333-3333-4333-8333-333333333333",
    email: "admin@example.com",
    name: "Admin",
  },
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:01:00.000Z",
  startedAt: "2026-07-20T10:00:05.000Z",
  completedAt: null,
};

describe("HubSpot import failed-row retry route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({
      ok: true,
      userId: "33333333-3333-4333-8333-333333333333",
      userEmail: "admin@example.com",
      role: "admin",
    });
    retryMock.mockResolvedValue({ batch, retriedRowCount: 1 });
  });

  it("validates and delegates a failed-row retry", async () => {
    const response = await POST(
      new Request("http://localhost/api/hubspot-import-batches/11111111-1111-4111-8111-111111111111/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "failed_rows" }),
      }),
      { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ batch, retriedRowCount: 1 });
    expect(retryMock).toHaveBeenCalledWith({
      importBatchId: "11111111-1111-4111-8111-111111111111",
      requestedByUserId: "33333333-3333-4333-8333-333333333333",
      role: "admin",
    });
  });

  it("rejects malformed input without calling core", async () => {
    const response = await POST(
      new Request("http://localhost/api/hubspot-import-batches/11111111-1111-4111-8111-111111111111/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "all_rows" }),
      }),
      { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
    );

    expect(response.status).toBe(400);
    expect(retryMock).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    const denied = Response.json({ error: "Unauthorized" }, { status: 401 });
    requireSessionMock.mockResolvedValue({ ok: false, response: denied });

    await expect(
      POST(
        new Request("http://localhost/retry", {
          method: "POST",
          body: JSON.stringify({ scope: "failed_rows" }),
        }),
        { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
      ),
    ).resolves.toBe(denied);
    expect(retryMock).not.toHaveBeenCalled();
  });
});
