import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dashboardWorkspaceMock } = vi.hoisted(() => ({
  dashboardWorkspaceMock: vi.fn(() => "dashboard-workspace"),
}));

vi.mock("../../../components/dashboard/dashboard-workspace", () => ({
  DashboardWorkspace: dashboardWorkspaceMock,
}));

import DashboardPage from "./page";

describe("dashboard page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the dashboard workspace", () => {
    const html = renderToStaticMarkup(DashboardPage());

    expect(html).toContain("Dashboard");
    expect(html).toContain(
      "Review recent scouting runs, track coverage against each run target, and hand each run off to Database, CSV export, or HubSpot from one compact table.",
    );
    expect(dashboardWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("dashboard-workspace");
  });
});
