import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, requireAdminMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  requireAdminMock: vi.fn(),
}));

vi.mock("@scouting-platform/core", () => ({ listHubspotConflicts: listMock }));
vi.mock("../../../../lib/api", () => ({
  requireAdminSession: requireAdminMock,
  toRouteErrorResponse: vi.fn(() => Response.json({ error: "failed" }, { status: 500 })),
}));

import { GET } from "./route";

describe("HubSpot conflicts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-id" });
    listMock.mockResolvedValue([]);
  });

  it("requires an admin session and returns open conflicts by default", async () => {
    const response = await GET(new Request("http://localhost/api/database/hubspot-conflicts"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    expect(listMock).toHaveBeenCalledWith({ status: "open" });
  });

  it("rejects invalid status filters", async () => {
    const response = await GET(
      new Request("http://localhost/api/database/hubspot-conflicts?status=broken"),
    );
    expect(response.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("returns the authentication response without reading data", async () => {
    const denied = Response.json({ error: "Forbidden" }, { status: 403 });
    requireAdminMock.mockResolvedValue({ ok: false, response: denied });

    await expect(
      GET(new Request("http://localhost/api/database/hubspot-conflicts")),
    ).resolves.toBe(denied);
    expect(listMock).not.toHaveBeenCalled();
  });
});
