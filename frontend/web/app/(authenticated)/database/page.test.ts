import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStringAsync } from "../../../lib/test-render";

const { getSessionMock, databaseAdminWorkspaceMock, getCachedCampaignsMock, getCachedClientsMock, getCachedDropdownValuesMock } =
  vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  databaseAdminWorkspaceMock: vi.fn(() => "database-admin-workspace"),
  getCachedCampaignsMock: vi.fn(async () => ({
    items: [],
    filterOptions: { clients: [], markets: [] },
    permissions: { canCreate: true, role: "user", userType: "campaign_manager" as const },
  })),
  getCachedClientsMock: vi.fn(async () => ({
    items: [],
    permissions: { canCreate: true },
  })),
  getCachedDropdownValuesMock: vi.fn(async () => ({
    items: [],
  })),
}));

vi.mock("../../../lib/cached-auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("../../../components/database/database-admin-workspace", () => ({
  DatabaseAdminWorkspace: databaseAdminWorkspaceMock,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("../../../lib/cached-data", () => ({
  getCachedCampaigns: getCachedCampaignsMock,
  getCachedClients: getCachedClientsMock,
  getCachedDropdownValues: getCachedDropdownValuesMock,
}));

import DatabasePage from "./page";

describe("database page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });
  });

  it("renders the database workspace for authenticated users", async () => {
    const html = await renderToStringAsync(DatabasePage());

    expect(databaseAdminWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("Database");
    expect(html).toContain(
      "Manage clients and campaigns from one database workspace while keeping creator catalog browsing in its own dedicated page.",
    );
    expect(html).toContain("database-admin-workspace");
  });
});
