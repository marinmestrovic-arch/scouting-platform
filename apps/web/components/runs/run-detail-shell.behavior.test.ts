import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRunStatusMock, useEffectMock, useStateMock } = vi.hoisted(() => ({
  fetchRunStatusMock: vi.fn(),
  useEffectMock: vi.fn(),
  useStateMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useEffect: useEffectMock,
    useState: useStateMock,
  };
});

vi.mock("../../lib/runs-api", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiRequestError";
      this.status = status;
    }
  },
  fetchRunStatus: fetchRunStatusMock,
}));

import { ApiRequestError } from "../../lib/runs-api";
import { RunDetailShell, RUN_STATUS_POLL_INTERVAL_MS } from "./run-detail-shell";

type RunDetailShellElement = ReactElement<{
  onRetry: () => void;
}>;

function buildRunStatusPayload(status: "queued" | "running" | "completed" | "failed") {
  return {
    id: "53adac17-f39d-4731-a61f-194150fbc431",
    requestedByUserId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
    name: "Gaming Run",
    query: "gaming creators",
    target: 20,
    status,
    lastError: null,
    createdAt: "2026-03-10T10:00:00.000Z",
    updatedAt: "2026-03-10T10:03:00.000Z",
    startedAt: "2026-03-10T10:01:00.000Z",
    completedAt: status === "completed" ? "2026-03-10T10:03:00.000Z" : null,
    results: [],
  };
}

function renderShell(options?: {
  requestState?: {
    status: "loading" | "error" | "notFound" | "ready";
    data: null | ReturnType<typeof buildRunStatusPayload>;
    error: string | null;
  };
  reloadToken?: number;
}) {
  const setRequestState = vi.fn();
  const setReloadToken = vi.fn();
  const cleanups: Array<() => void> = [];

  useStateMock.mockReset();
  useEffectMock.mockReset();
  useStateMock
    .mockReturnValueOnce([
      options?.requestState ?? {
        status: "loading",
        data: null,
        error: null,
      },
      setRequestState,
    ])
    .mockReturnValueOnce([options?.reloadToken ?? 0, setReloadToken]);
  useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
    const maybeCleanup = effect();

    if (typeof maybeCleanup === "function") {
      cleanups.push(maybeCleanup);
    }
  });

  const element = RunDetailShell({
    runId: "53adac17-f39d-4731-a61f-194150fbc431",
  }) as RunDetailShellElement;

  return {
    cleanups,
    element,
    setReloadToken,
    setRequestState,
  };
}

describe("run detail shell behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads run status on mount, schedules polling for active runs, and aborts on cleanup", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
      void handler();
      return 123 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    fetchRunStatusMock.mockResolvedValueOnce(buildRunStatusPayload("running"));
    fetchRunStatusMock.mockResolvedValueOnce(buildRunStatusPayload("completed"));

    const { cleanups, setRequestState } = renderShell();

    expect(setRequestState).toHaveBeenNthCalledWith(1, {
      status: "loading",
      data: null,
      error: null,
    });
    expect(fetchRunStatusMock).toHaveBeenCalledWith(
      "53adac17-f39d-4731-a61f-194150fbc431",
      expect.any(AbortSignal),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenNthCalledWith(2, {
      status: "ready",
      data: buildRunStatusPayload("running"),
      error: null,
    });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), RUN_STATUS_POLL_INTERVAL_MS);

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenNthCalledWith(3, {
      status: "ready",
      data: buildRunStatusPayload("completed"),
      error: null,
    });

    const signal = fetchRunStatusMock.mock.calls[0]?.[1] as AbortSignal | undefined;

    cleanups.forEach((cleanup) => {
      cleanup();
    });

    expect(signal?.aborted).toBe(true);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
  });

  it("marks the screen as not found when the run no longer exists", async () => {
    fetchRunStatusMock.mockRejectedValueOnce(new ApiRequestError("Run not found.", 404));

    const { setRequestState } = renderShell();

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenLastCalledWith({
      status: "notFound",
      data: null,
      error: null,
    });
  });
});
