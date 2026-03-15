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
  onPromptChange: (value: string) => void;
  onSubmit: (event: { preventDefault: () => void }) => Promise<void>;
}>;

function renderWorkspace(options?: {
  draft?: {
    prompt: string;
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
        prompt: "gaming creators",
      },
      setDraft,
    ])
    .mockReturnValueOnce([
      options?.requestState ?? {
        status: "idle",
        message:
          "Only the prompt is live today. Campaign, week, brief, and targeting controls are scaffolded until the backend stores those fields.",
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
        prompt: "  gaming creators for DACH  ",
      },
    });

    await element.props.onSubmit({
      preventDefault: vi.fn(),
    });
    await Promise.resolve();

    expect(createRunMock).toHaveBeenCalledWith({
      name: "Scouting: gaming creators for DACH",
      query: "gaming creators for DACH",
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
        message: "Prompt is required.",
      },
    });

    element.props.onPromptChange("updated prompt");

    expect(setRequestState).toHaveBeenCalledWith({
      status: "idle",
      message:
        "Only the prompt is live today. Campaign, week, brief, and targeting controls are scaffolded until the backend stores those fields.",
    });
    expect(setDraft).toHaveBeenCalledWith({
      prompt: "updated prompt",
    });
  });
});
