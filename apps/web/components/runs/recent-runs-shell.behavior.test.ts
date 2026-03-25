import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRecentRunsMock, useEffectMock, useStateMock } = vi.hoisted(() => ({
  fetchRecentRunsMock: vi.fn(),
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
  fetchRecentRuns: fetchRecentRunsMock,
}));

import { ApiRequestError } from "../../lib/runs-api";
import { RUN_STATUS_POLL_INTERVAL_MS } from "./run-presentation";
import { RecentRunsShell } from "./recent-runs-shell";

type RecentRunsShellElement = ReactElement<{
  onRetry: () => void;
}>;

function buildRunMetadata() {
  return {
    client: "Sony",
    market: "DACH",
    campaignManagerUserId: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
    campaignManager: {
      id: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
      email: "manager@example.com",
      name: "Manager",
    },
    briefLink: "https://example.com/brief",
    campaignName: "Spring Launch 2026",
    month: "march" as const,
    year: 2026,
    dealOwner: "Marin",
    dealName: "Sony Gaming Q2",
    pipeline: "New business",
    dealStage: "Contract sent",
    currency: "EUR",
    dealType: "Paid social",
    activationType: "YouTube integration",
  };
}

function buildRecentRunsPayload(status: "queued" | "running" | "completed" | "failed") {
  return {
    items: [
      {
        id: "53adac17-f39d-4731-a61f-194150fbc431",
        name: "Gaming Run",
        query: "gaming creators",
        target: null,
        status,
        lastError: null,
        createdAt: "2026-03-10T10:00:00.000Z",
        updatedAt: "2026-03-10T10:03:00.000Z",
        startedAt: "2026-03-10T10:01:00.000Z",
        completedAt: status === "completed" ? "2026-03-10T10:03:00.000Z" : null,
        resultCount: status === "completed" ? 2 : 0,
        metadata: buildRunMetadata(),
      },
    ],
    filterOptions: {
      campaignManagers: [buildRunMetadata().campaignManager],
      clients: ["Sony"],
      markets: ["DACH"],
    },
  };
}

function renderShell(options?: {
  requestState?: {
    status: "loading" | "error" | "ready";
    data: null | ReturnType<typeof buildRecentRunsPayload>;
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

  const element = RecentRunsShell() as RecentRunsShellElement;

  return {
    cleanups,
    element,
    setReloadToken,
    setRequestState,
  };
}

describe("recent runs shell behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads recent runs on mount, polls while active runs exist, and aborts on cleanup", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
      void handler();
      return 456 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    fetchRecentRunsMock.mockResolvedValueOnce(buildRecentRunsPayload("running"));
    fetchRecentRunsMock.mockResolvedValueOnce(buildRecentRunsPayload("completed"));

    const { cleanups, setRequestState } = renderShell();

    expect(setRequestState).toHaveBeenNthCalledWith(1, {
      status: "loading",
      data: null,
      error: null,
    });
    expect(fetchRecentRunsMock).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenNthCalledWith(2, {
      status: "ready",
      data: buildRecentRunsPayload("running"),
      error: null,
    });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), RUN_STATUS_POLL_INTERVAL_MS);

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenNthCalledWith(3, {
      status: "ready",
      data: buildRecentRunsPayload("completed"),
      error: null,
    });

    const signal = fetchRecentRunsMock.mock.calls[0]?.[0]?.signal as AbortSignal | undefined;

    cleanups.forEach((cleanup) => {
      cleanup();
    });

    expect(signal?.aborted).toBe(true);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(456);
  });

  it("maps recent runs request failures to the error state", async () => {
    fetchRecentRunsMock.mockRejectedValueOnce(
      new ApiRequestError("You are not authorized to view recent runs.", 403),
    );

    const { setRequestState } = renderShell();

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenLastCalledWith({
      status: "error",
      data: null,
      error: "Your session does not allow access to recent runs anymore. Sign in again and retry.",
    });
  });

  it("bumps the reload token when retrying manually", () => {
    const { element, setReloadToken } = renderShell({
      requestState: {
        status: "ready",
        data: buildRecentRunsPayload("completed"),
        error: null,
      },
    });

    element.props.onRetry();

    expect(setReloadToken).toHaveBeenCalledWith(expect.any(Function));
  });
});
