import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createMock,
  blockersMock,
  listMock,
  requireSessionMock,
  routeErrorMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  blockersMock: vi.fn(),
  listMock: vi.fn(),
  requireSessionMock: vi.fn(),
  routeErrorMock: vi.fn(() => Response.json({ error: "failed" }, { status: 500 })),
}));

vi.mock("@scouting-platform/core", () => ({
  createHubspotImportBatch: createMock,
  getHubspotImportBlockers: blockersMock,
  listHubspotImportBatches: listMock,
}));

vi.mock("../../../lib/api", () => ({
  readJsonRequestBody: async (request: Request) => {
    try {
      return { ok: true, body: await request.json() };
    } catch {
      return {
        ok: false,
        response: Response.json({ error: "Invalid request payload" }, { status: 400 }),
      };
    }
  },
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
};

describe("HubSpot import batch route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({
      ok: true,
      userId: "33333333-3333-4333-8333-333333333333",
      userEmail: "admin@example.com",
      role: "admin",
    });
    blockersMock.mockResolvedValue([]);
    createMock.mockResolvedValue(batch);
  });

  it("passes direct Object API mode to the core service", async () => {
    const response = await POST(
      new Request("http://localhost/api/hubspot-import-batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: "22222222-2222-4222-8222-222222222222",
          deliveryMode: "direct_object_api",
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(createMock).toHaveBeenCalledWith({
      runId: "22222222-2222-4222-8222-222222222222",
      deliveryMode: "direct_object_api",
      requestedByUserId: "33333333-3333-4333-8333-333333333333",
      role: "admin",
    });
  });

  it("keeps CSV as the compatibility default when mode is omitted", async () => {
    await POST(
      new Request("http://localhost/api/hubspot-import-batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: "22222222-2222-4222-8222-222222222222",
        }),
      }),
    );

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryMode: "csv_fallback" }),
    );
  });

  it("returns field blockers without creating a batch", async () => {
    blockersMock.mockResolvedValue([
      {
        scope: "run",
        runId: "22222222-2222-4222-8222-222222222222",
        channelId: null,
        contactEmail: null,
        field: "pipeline",
        message: "Pipeline is required before creating a HubSpot import batch",
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/hubspot-import-batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: "22222222-2222-4222-8222-222222222222",
          deliveryMode: "direct_object_api",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/hubspot-import-batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});
