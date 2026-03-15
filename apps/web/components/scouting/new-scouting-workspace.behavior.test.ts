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
  };
});

vi.mock("next/navigation", () => ({
  useRouter: useRouterMock,
}));

vi.mock("../../lib/runs-api", () => ({
  createRun: createRunMock,
}));

import { NewScoutingWorkspace } from "./new-scouting-workspace";

type NewScoutingWorkspaceElement = ReactElement<{
  onNameChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onTargetChange: (value: string) => void;
  onSubmit: (event: { preventDefault: () => void }) => Promise<void>;
}>;

function renderWorkspace(options?: {
  draft?: {
    name: string;
    prompt: string;
    target: string;
  };
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
    .mockReturnValueOnce([
      options?.draft ?? {
        name: "Gaming run",
        prompt: "gaming creators",
        target: "20",
      },
      setDraft,
    ])
    .mockReturnValueOnce([
      options?.requestState ?? {
        status: "idle",
        message:
          "Run name, target, and prompt are live today. Campaign, week, brief, and remaining planning controls stay scaffolded until the backend stores those fields.",
      },
      setRequestState,
    ]);

  const element = NewScoutingWorkspace({}) as NewScoutingWorkspaceElement;

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

  it("submits only the live prompt fields and navigates into database runs", async () => {
    createRunMock.mockResolvedValue({
      runId: "53adac17-f39d-4731-a61f-194150fbc431",
      status: "queued",
    });

    const { element, setRequestState } = renderWorkspace({
      draft: {
        name: "  Spring gaming outreach  ",
        prompt: "  gaming creators for DACH  ",
        target: " 25 ",
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
        message: "Run name, target, and prompt are required.",
      },
    });

    element.props.onPromptChange("updated prompt");

    expect(setRequestState).toHaveBeenCalledWith({
      status: "idle",
      message:
        "Run name, target, and prompt are live today. Campaign, week, brief, and remaining planning controls stay scaffolded until the backend stores those fields.",
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
        message: "Run name, target, and prompt are required.",
      },
    });

    element.props.onNameChange("Updated run");

    expect(setRequestState).toHaveBeenCalledWith({
      status: "idle",
      message:
        "Run name, target, and prompt are live today. Campaign, week, brief, and remaining planning controls stay scaffolded until the backend stores those fields.",
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
        message: "Run name, target, and prompt are required.",
      },
    });

    element.props.onTargetChange("35");

    expect(setRequestState).toHaveBeenCalledWith({
      status: "idle",
      message:
        "Run name, target, and prompt are live today. Campaign, week, brief, and remaining planning controls stay scaffolded until the backend stores those fields.",
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
