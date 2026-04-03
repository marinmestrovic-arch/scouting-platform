import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStringAsync } from "../../../lib/test-render";

const { getSessionMock, listCampaignManagersMock, listCampaignsMock, newScoutingWorkspaceMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  listCampaignManagersMock: vi.fn(async () => []),
  listCampaignsMock: vi.fn(async () => ({
    items: [],
    filterOptions: { clients: [], markets: [] },
    permissions: { canCreate: false, role: "user", userType: "campaign_manager" },
  })),
  newScoutingWorkspaceMock: vi.fn(() => "new-scouting-workspace"),
}));

vi.mock("../../../lib/cached-auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("../../../lib/cached-data", () => ({
  getCachedCampaignManagers: listCampaignManagersMock,
  getCachedCampaigns: listCampaignsMock,
}));

vi.mock("../../../components/scouting/new-scouting-workspace", () => ({
  NewScoutingWorkspace: newScoutingWorkspaceMock,
}));

import NewScoutingPage from "./page";

describe("new scouting page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });
  });

  it("renders the new scouting workspace", async () => {
    const html = await renderToStringAsync(NewScoutingPage());

    expect(html).toContain("New scouting");
    expect(html).toContain(
      "Start a scouting run from an active campaign with the minimum required input and preserve campaign data as a run snapshot.",
    );
    expect(newScoutingWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("new-scouting-workspace");
  });
});
