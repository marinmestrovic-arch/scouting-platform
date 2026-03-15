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
  ApiRequestError: class ApiRequestError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiRequestError";
      this.status = status;
    }
  },
  createRun: createRunMock,
}));

import { CreateRunShell } from "./create-run-shell";

type CreateRunShellElement = ReactElement<{
  onNameChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onTargetChange: (value: string) => void;
  onSubmit: (event: { preventDefault: () => void }) => Promise<void>;
}>;

function renderShell(options?: {
  draft?: {
    name: string;
    query: string;
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
        name: "Gaming Run",
        query: "gaming creators",
        target: "20",
      },
      setDraft,
    ])
    .mockReturnValueOnce([
      options?.requestState ?? {
        status: "idle",
        message:
          "Runs blend matching catalog channels with new YouTube discovery using the API key assigned to your account.",
      },
      setRequestState,
    ]);

  const element = CreateRunShell({}) as CreateRunShellElement;

  return {
    element,
    setDraft,
    setRequestState,
  };
}

describe("create run shell behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits a normalized run draft and navigates to the detail page", async () => {
    createRunMock.mockResolvedValue({
      runId: "53adac17-f39d-4731-a61f-194150fbc431",
      status: "queued",
    });

    const { element, setRequestState } = renderShell({
      draft: {
        name: "  Gaming Run  ",
        query: "  gaming creators  ",
        target: " 20 ",
      },
    });

    await element.props.onSubmit({
      preventDefault: vi.fn(),
    });
    await Promise.resolve();

    expect(createRunMock).toHaveBeenCalledWith({
      name: "Gaming Run",
      query: "gaming creators",
      target: 20,
    });
    expect(setRequestState).toHaveBeenCalledWith({
      status: "submitting",
      message: "Creating the run and opening its live status page.",
    });
    expect(pushMock).toHaveBeenCalledWith("/runs/53adac17-f39d-4731-a61f-194150fbc431");
  });

  it("clears error state when the draft changes", () => {
    const { element, setDraft, setRequestState } = renderShell({
      requestState: {
        status: "error",
        message: "Your account does not have an assigned YouTube API key yet.",
      },
    });

    element.props.onNameChange("Updated run");

    expect(setRequestState).toHaveBeenCalledWith({
      status: "idle",
      message:
        "Runs blend matching catalog channels with new YouTube discovery using the API key assigned to your account.",
    });

    const updateDraft = setDraft.mock.calls[0]?.[0] as ((value: {
      name: string;
      query: string;
      target: string;
    }) => {
      name: string;
      query: string;
      target: string;
    }) | undefined;

    expect(updateDraft?.({ name: "Gaming Run", query: "gaming creators", target: "20" })).toEqual({
      name: "Updated run",
      query: "gaming creators",
      target: "20",
    });
  });
});
