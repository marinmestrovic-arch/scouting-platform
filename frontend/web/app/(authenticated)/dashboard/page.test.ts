import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStringAsync } from "../../../lib/test-render";

const { getSessionMock, dashboardWorkspaceMock, listRecentRunsMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
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

vi.mock("../../../lib/cached-auth", () => ({
  getSession: getSessionMock,
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
    getSessionMock.mockResolvedValue({
      user: {
        id: "user-1",
        role: "user",
      },
    });
  });

  it("renders the dashboard workspace", async () => {
    const html = await renderToStringAsync(DashboardPage());

    expect(html).toContain("Dashboard");
    expect(html).toContain(
      "Review recent scouting runs, track coverage against each run target, and hand each run off to Database, CSV export, or HubSpot from one compact table.",
    );
    expect(dashboardWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("dashboard-workspace");
  });
});
