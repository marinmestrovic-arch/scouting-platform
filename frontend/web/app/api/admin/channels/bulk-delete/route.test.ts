import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  bulkDeleteChannelsMock,
  requireAdminSessionMock,
  toRouteErrorResponseMock,
} = vi.hoisted(() => ({
  bulkDeleteChannelsMock: vi.fn(),
  requireAdminSessionMock: vi.fn(),
  toRouteErrorResponseMock: vi.fn((error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : "error" }, { status: 500 }),
  ),
}));

vi.mock("@scouting-platform/core", () => ({
  bulkDeleteChannels: bulkDeleteChannelsMock,
}));

vi.mock("../../../../../lib/api", () => ({
  readJsonRequestBody: async (request: Request) => {
    try {
      return {
        ok: true,
        body: await request.json(),
      };
    } catch {
      return {
        ok: false,
        response: Response.json({ error: "Invalid request payload" }, { status: 400 }),
      };
    }
  },
  requireAdminSession: requireAdminSessionMock,
  toRouteErrorResponse: toRouteErrorResponseMock,
}));

import { POST } from "./route";

const adminUserId = "11111111-1111-4111-8111-111111111111";
const channelIds = [
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

describe("admin channel bulk delete route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSessionMock.mockResolvedValue({
      ok: true,
      userId: adminUserId,
    });
  });

  it("deletes selected channels for admins", async () => {
    bulkDeleteChannelsMock.mockResolvedValue({
      requestedCount: 2,
      deletedCount: 2,
    });

    const response = await POST(
      new Request("http://localhost/api/admin/channels/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelIds }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requestedCount: 2,
      deletedCount: 2,
    });
    expect(bulkDeleteChannelsMock).toHaveBeenCalledWith({
      actorUserId: adminUserId,
      channelIds,
    });
  });

  it("rejects non-admin requests before parsing the payload", async () => {
    const forbiddenResponse = Response.json({ error: "Forbidden" }, { status: 403 });

    requireAdminSessionMock.mockResolvedValue({
      ok: false,
      response: forbiddenResponse,
    });

    const response = await POST(
      new Request("http://localhost/api/admin/channels/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelIds }),
      }),
    );

    expect(response.status).toBe(403);
    expect(bulkDeleteChannelsMock).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/channels/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelIds: ["not-a-uuid"] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: "Invalid request payload",
      }),
    );
    expect(bulkDeleteChannelsMock).not.toHaveBeenCalled();
  });
});
