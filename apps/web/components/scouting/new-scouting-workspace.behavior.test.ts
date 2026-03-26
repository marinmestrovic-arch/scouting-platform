import type { ReactElement, ReactNode } from "react";
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
    startTransition: (callback: () => void) => callback(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: useRouterMock,
}));

vi.mock("../../lib/runs-api", () => ({
  createRun: createRunMock,
}));

import { NewScoutingWorkspace } from "./new-scouting-workspace";

const CAMPAIGN_MANAGER_OPTION = {
  id: "cm-uuid-001",
  email: "manager@example.com",
  name: "Campaign Manager",
};

const CAMPAIGN_OPTION = {
  id: "campaign-1",
  name: "Sony Gaming Q2",
  client: {
    id: "client-1",
    name: "Sony",
  },
  market: {
    id: "market-1",
    name: "DACH",
  },
  briefLink: null,
  month: "march" as const,
  year: 2026,
  isActive: true,
  createdAt: "2026-03-26T12:00:00.000Z",
  updatedAt: "2026-03-26T12:00:00.000Z",
};

const DEFAULT_TEST_DRAFT = {
  name: "Gaming run",
  prompt: "gaming creators",
  target: "20",
  campaignId: CAMPAIGN_OPTION.id,
  campaignManagerUserId: CAMPAIGN_MANAGER_OPTION.id,
};

const IDLE_MESSAGE = "Pick an active campaign and start a scouting list with the minimum required input.";

function findElementsByType(node: ReactNode, type: string): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findElementsByType(child, type));
  }

  if (!node || typeof node !== "object" || !("props" in node)) {
    return [];
  }

  const element = node as ReactElement<Record<string, unknown>>;

  return [
    ...(element.type === type ? [element] : []),
    ...findElementsByType(element.props.children as ReactNode, type),
  ];
}

function renderWorkspace(options?: {
  draft?: typeof DEFAULT_TEST_DRAFT;
  requestState?: {
    status: "idle" | "submitting" | "error";
    message: string;
  };
}) {
  const setDraft = vi.fn();
  const setRequestState = vi.fn();

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
    ]);

  const element = NewScoutingWorkspace({
    initialCampaignManagers: [CAMPAIGN_MANAGER_OPTION],
    initialCampaigns: [CAMPAIGN_OPTION],
  });

  return {
    element,
    setDraft,
    setRequestState,
  };
}

describe("new scouting workspace behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits campaign-centric metadata and navigates into the run page", async () => {
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
      },
    });

    const form = findElementsByType(element, "form")[0] as ReactElement<{
      onSubmit: (event: { preventDefault: () => void }) => Promise<void>;
    }>;

    await form.props.onSubmit({
      preventDefault: vi.fn(),
    });
    await Promise.resolve();

    expect(createRunMock).toHaveBeenCalledWith({
      name: "Spring gaming outreach",
      query: "gaming creators for DACH",
      target: 25,
      metadata: {
        campaignId: CAMPAIGN_OPTION.id,
        campaignManagerUserId: CAMPAIGN_MANAGER_OPTION.id,
      },
    });
    expect(setRequestState).toHaveBeenCalledWith({
      status: "submitting",
      message: "Creating the scouting run.",
    });
    expect(pushMock).toHaveBeenCalledWith("/runs/53adac17-f39d-4731-a61f-194150fbc431");
  });

  it("updates the prompt draft when the prompt field changes", () => {
    const { element, setDraft } = renderWorkspace();
    const textareas = findElementsByType(element, "textarea") as Array<
      ReactElement<{ onChange: (event: { currentTarget: { value: string } }) => void }>
    >;

    textareas[0]?.props.onChange({ currentTarget: { value: "updated prompt" } });

    const updateDraft = setDraft.mock.calls[0]?.[0] as
      | ((draft: typeof DEFAULT_TEST_DRAFT) => typeof DEFAULT_TEST_DRAFT)
      | undefined;

    expect(updateDraft?.(DEFAULT_TEST_DRAFT)).toEqual({
      ...DEFAULT_TEST_DRAFT,
      prompt: "updated prompt",
    });
  });

  it("updates the run name draft when the name field changes", () => {
    const { element, setDraft } = renderWorkspace();
    const inputs = findElementsByType(element, "input") as Array<
      ReactElement<{ onChange: (event: { currentTarget: { value: string } }) => void }>
    >;

    inputs[0]?.props.onChange({ currentTarget: { value: "Updated run" } });

    const updateDraft = setDraft.mock.calls[0]?.[0] as
      | ((draft: typeof DEFAULT_TEST_DRAFT) => typeof DEFAULT_TEST_DRAFT)
      | undefined;

    expect(updateDraft?.(DEFAULT_TEST_DRAFT)).toEqual({
      ...DEFAULT_TEST_DRAFT,
      name: "Updated run",
    });
  });

  it("updates the target draft when the target field changes", () => {
    const { element, setDraft } = renderWorkspace();
    const inputs = findElementsByType(element, "input") as Array<
      ReactElement<{ onChange: (event: { currentTarget: { value: string } }) => void }>
    >;

    inputs[1]?.props.onChange({ currentTarget: { value: "35" } });

    const updateDraft = setDraft.mock.calls[0]?.[0] as
      | ((draft: typeof DEFAULT_TEST_DRAFT) => typeof DEFAULT_TEST_DRAFT)
      | undefined;

    expect(updateDraft?.(DEFAULT_TEST_DRAFT)).toEqual({
      ...DEFAULT_TEST_DRAFT,
      target: "35",
    });
  });
});
