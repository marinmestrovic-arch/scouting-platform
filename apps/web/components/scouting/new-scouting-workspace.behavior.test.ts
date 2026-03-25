import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRunMock, pushMock, useRouterMock, useStateMock } = vi.hoisted(() => ({
  createRunMock: vi.fn(),
  pushMock: vi.fn(),
  useRouterMock: vi.fn(),
  useStateMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useState: useStateMock,
    useEffect: vi.fn(),
    startTransition: (callback: () => void) => callback(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: useRouterMock,
}));

vi.mock("../../lib/runs-api", () => ({
  createRun: createRunMock,
}));

vi.mock("../../lib/campaign-managers-api", () => ({
  fetchCampaignManagers: vi.fn(),
}));

import { NewScoutingWorkspace } from "./new-scouting-workspace";

type NewScoutingWorkspaceElement = ReactElement<{
  onFieldChange: (field: string, value: string) => void;
  onSubmit: (event: { preventDefault: () => void }) => Promise<void>;
}>;

const CAMPAIGN_MANAGER_OPTION = {
  id: "cm-uuid-001",
  email: "manager@example.com",
  name: "Campaign Manager",
};

const DEFAULT_TEST_DRAFT = {
  name: "Gaming run",
  prompt: "gaming creators",
  target: "20",
  client: "Sony",
  market: "DACH",
  campaignManagerUserId: CAMPAIGN_MANAGER_OPTION.id,
  briefLink: "",
  campaignName: "Sony Gaming Q2",
  month: "march" as const,
  year: "2026",
  dealOwner: "Marin",
  dealName: "Sony Gaming Q2 Deal",
  pipeline: "New business",
  dealStage: "Contract sent",
  currency: "EUR",
  dealType: "Paid social",
  activationType: "YouTube integration",
};

const IDLE_MESSAGE =
  "This workspace now stores the live campaign metadata required for Dashboard filtering and HubSpot import readiness.";

function renderWorkspace(options?: {
  draft?: typeof DEFAULT_TEST_DRAFT;
  requestState?: {
    status: "idle" | "submitting" | "error";
    message: string;
  };
}) {
  const setDraft = vi.fn();
  const setRequestState = vi.fn();
  const setCampaignManagersState = vi.fn();

  useStateMock.mockReset();
  useRouterMock.mockReturnValue({
    push: pushMock,
  });
  useStateMock
    .mockReturnValueOnce([options?.draft ?? DEFAULT_TEST_DRAFT, setDraft])
    .mockReturnValueOnce([
      options?.requestState ?? {
        status: "idle",
        message: IDLE_MESSAGE,
      },
      setRequestState,
    ])
    .mockReturnValueOnce([
      {
        status: "ready",
        items: [CAMPAIGN_MANAGER_OPTION],
        error: null,
      },
      setCampaignManagersState,
    ]);

  const element = NewScoutingWorkspace({}) as NewScoutingWorkspaceElement;

  return {
    element,
    setDraft,
    setRequestState,
    setCampaignManagersState,
  };
}

describe("new scouting workspace behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits all metadata fields and navigates into database runs", async () => {
    createRunMock.mockResolvedValue({
      runId: "53adac17-f39d-4731-a61f-194150fbc431",
      status: "queued",
    });

    const { element, setRequestState } = renderWorkspace({
      draft: {
        ...DEFAULT_TEST_DRAFT,
        name: "  Spring gaming outreach  ",
        prompt: "  gaming creators for DACH  ",
        target: " 25 ",
        briefLink: "",
      },
    });

    await element.props.onSubmit({
      preventDefault: vi.fn(),
    });
    await Promise.resolve();

    expect(createRunMock).toHaveBeenCalledWith({
      name: "Spring gaming outreach",
      query: "gaming creators for DACH",
      target: 25,
      metadata: {
        client: "Sony",
        market: "DACH",
        campaignManagerUserId: CAMPAIGN_MANAGER_OPTION.id,
        briefLink: undefined,
        campaignName: "Sony Gaming Q2",
        month: "march",
        year: 2026,
        dealOwner: "Marin",
        dealName: "Sony Gaming Q2 Deal",
        pipeline: "New business",
        dealStage: "Contract sent",
        currency: "EUR",
        dealType: "Paid social",
        activationType: "YouTube integration",
      },
    });
    expect(setRequestState).toHaveBeenCalledWith({
      status: "submitting",
      message: "Creating the scouting run and opening it inside Database.",
    });
    expect(pushMock).toHaveBeenCalledWith(
      "/database?tab=runs&runId=53adac17-f39d-4731-a61f-194150fbc431",
    );
  });

  it("clears error state when the prompt changes", () => {
    const { element, setDraft, setRequestState } = renderWorkspace({
      requestState: {
        status: "error",
        message: "Influencer List, target, and prompt are required.",
      },
    });

    element.props.onFieldChange("prompt", "updated prompt");

    expect(setRequestState).toHaveBeenCalledWith({
      status: "idle",
      message: IDLE_MESSAGE,
    });
    const updateDraft = setDraft.mock.calls[0]?.[0] as
      | ((draft: { name: string; prompt: string; target: string }) => {
          name: string;
          prompt: string;
          target: string;
        })
      | undefined;

    expect(updateDraft?.({ name: "Gaming run", prompt: "gaming creators", target: "20" })).toEqual({
      name: "Gaming run",
      prompt: "updated prompt",
      target: "20",
    });
  });

  it("clears error state when the run name changes", () => {
    const { element, setDraft, setRequestState } = renderWorkspace({
      requestState: {
        status: "error",
        message: "Influencer List, target, and prompt are required.",
      },
    });

    element.props.onFieldChange("name", "Updated run");

    expect(setRequestState).toHaveBeenCalledWith({
      status: "idle",
      message: IDLE_MESSAGE,
    });
    const updateDraft = setDraft.mock.calls[0]?.[0] as
      | ((draft: { name: string; prompt: string; target: string }) => {
          name: string;
          prompt: string;
          target: string;
        })
      | undefined;

    expect(updateDraft?.({ name: "Gaming run", prompt: "gaming creators", target: "20" })).toEqual({
      name: "Updated run",
      prompt: "gaming creators",
      target: "20",
    });
  });

  it("clears error state when the target changes", () => {
    const { element, setDraft, setRequestState } = renderWorkspace({
      requestState: {
        status: "error",
        message: "Influencer List, target, and prompt are required.",
      },
    });

    element.props.onFieldChange("target", "35");

    expect(setRequestState).toHaveBeenCalledWith({
      status: "idle",
      message: IDLE_MESSAGE,
    });
    const updateDraft = setDraft.mock.calls[0]?.[0] as
      | ((draft: { name: string; prompt: string; target: string }) => {
          name: string;
          prompt: string;
          target: string;
        })
      | undefined;

    expect(updateDraft?.({ name: "Gaming run", prompt: "gaming creators", target: "20" })).toEqual({
      name: "Gaming run",
      prompt: "gaming creators",
      target: "35",
    });
  });
});
