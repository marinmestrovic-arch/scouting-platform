import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, dashboardWorkspaceMock, listRecentRunsMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  dashboardWorkspaceMock: vi.fn(() => "dashboard-workspace"),
  listRecentRunsMock: vi.fn(async () => ({
    items: [],
    filterOptions: {
      campaignManagers: [],
      clients: [],
      markets: [],
    },
  })),
}));

vi.mock("../../../auth", () => ({
  auth: authMock,
}));

vi.mock("@scouting-platform/core", () => ({
  listRecentRuns: listRecentRunsMock,
}));

vi.mock("../../../components/dashboard/dashboard-workspace", () => ({
  DashboardWorkspace: dashboardWorkspaceMock,
}));

import DashboardPage from "./page";

describe("dashboard page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
        role: "user",
      },
    });
  });

  it("renders the dashboard workspace", async () => {
    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("Dashboard");
    expect(html).toContain(
      "Review recent scouting runs, track coverage against each run target, and hand each run off to Database, CSV export, or HubSpot from one compact table.",
    );
    expect(dashboardWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("dashboard-workspace");
  });
});
