import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { authMock, databaseAdminWorkspaceMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  databaseAdminWorkspaceMock: vi.fn(() => "database-admin-workspace"),
}));

vi.mock("../../../auth", () => ({
  auth: authMock,
}));

vi.mock("../../../components/database/database-admin-workspace", () => ({
  DatabaseAdminWorkspace: databaseAdminWorkspaceMock,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@scouting-platform/core", () => ({
  listCampaigns: vi.fn(async () => ({
    items: [],
    filters: { clients: [], markets: [] },
    permissions: { canCreate: true },
  })),
  listClients: vi.fn(async () => ({
    items: [],
    permissions: { canCreate: true },
  })),
}));

import DatabasePage from "./page";

describe("database page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });
  });

  it("renders the database workspace for authenticated users", async () => {
    const page = await DatabasePage();
    const html = renderToStaticMarkup(page);

    expect(databaseAdminWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("Database");
    expect(html).toContain(
      "Manage clients and campaigns from one database workspace while keeping creator catalog browsing in its own dedicated page.",
    );
    expect(html).toContain("database-admin-workspace");
  });
});
