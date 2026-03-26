import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, listCampaignManagersMock, listCampaignsMock, newScoutingWorkspaceMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  listCampaignManagersMock: vi.fn(async () => []),
  listCampaignsMock: vi.fn(async () => ({
    items: [],
    filterOptions: { clients: [], markets: [] },
    permissions: { canCreate: false, role: "user", userType: "campaign_manager" },
  })),
  newScoutingWorkspaceMock: vi.fn(() => "new-scouting-workspace"),
}));

vi.mock("../../../auth", () => ({
  auth: authMock,
}));

vi.mock("@scouting-platform/core", () => ({
  listCampaignManagers: listCampaignManagersMock,
  listCampaigns: listCampaignsMock,
}));

vi.mock("../../../components/scouting/new-scouting-workspace", () => ({
  NewScoutingWorkspace: newScoutingWorkspaceMock,
}));

import NewScoutingPage from "./page";

describe("new scouting page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });
  });

  it("renders the new scouting workspace", async () => {
    const html = renderToStaticMarkup(await NewScoutingPage());

    expect(html).toContain("New scouting");
    expect(html).toContain(
      "Start a scouting run from an active campaign with the minimum required input and preserve campaign data as a run snapshot.",
    );
    expect(newScoutingWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("new-scouting-workspace");
  });
});
