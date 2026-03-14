import type {
  HubspotPushBatchDetail,
  HubspotPushBatchSummary,
} from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchHubspotPushBatchesMock,
  fetchHubspotPushBatchDetailMock,
  replaceMock,
  useEffectMock,
  usePathnameMock,
  useRouterMock,
  useSearchParamsMock,
  useStateMock,
} = vi.hoisted(() => ({
  fetchHubspotPushBatchesMock: vi.fn(),
  fetchHubspotPushBatchDetailMock: vi.fn(),
  replaceMock: vi.fn(),
  useEffectMock: vi.fn(),
  usePathnameMock: vi.fn(),
  useRouterMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
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

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useRouter: useRouterMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock("../../lib/hubspot-push-batches-api", () => ({
  HubspotPushBatchesApiError: class HubspotPushBatchesApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "HubspotPushBatchesApiError";
      this.status = status;
    }
  },
  fetchHubspotPushBatches: fetchHubspotPushBatchesMock,
  fetchHubspotPushBatchDetail: fetchHubspotPushBatchDetailMock,
}));

import {
  HUBSPOT_PUSH_HISTORY_POLL_INTERVAL_MS,
  HubspotPushManager,
  HubspotPushManagerView,
} from "./hubspot-push-manager";

type HubspotPushManagerViewProps = Parameters<typeof HubspotPushManagerView>[0];
type HubspotPushManagerElement = ReactElement<HubspotPushManagerViewProps>;

function buildSummary(overrides?: Partial<HubspotPushBatchSummary>): HubspotPushBatchSummary {
  return {
    id: "fdd240f2-ef31-43fe-b1d2-a584951654a8",
    status: "queued",
    totalRowCount: 2,
    pushedRowCount: 0,
    failedRowCount: 0,
    lastError: null,
    requestedBy: {
      id: "8c1136b4-1c95-4e8c-aefe-0e58df0a39d5",
      email: "manager@example.com",
      name: "Manager",
    },
    createdAt: "2026-03-13T09:00:00.000Z",
    updatedAt: "2026-03-13T09:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function buildDetail(overrides?: Partial<HubspotPushBatchDetail>): HubspotPushBatchDetail {
  return {
    ...buildSummary({
      status: "completed",
      pushedRowCount: 1,
      failedRowCount: 1,
      completedAt: "2026-03-13T09:02:00.000Z",
      ...overrides,
    }),
    scope: {
      channelIds: [
        "14e40450-71c2-4e0e-a160-b787d21843fd",
        "f3d0fbec-f8a0-40ad-8e19-2370c6b99083",
      ],
    },
    rows: [
      {
        id: "28ada809-e597-483e-9a7f-f568fc2f80dd",
        channelId: "14e40450-71c2-4e0e-a160-b787d21843fd",
        contactEmail: "creator@example.com",
        status: "pushed",
        hubspotObjectId: "hubspot-contact-1",
        errorMessage: null,
        createdAt: "2026-03-13T09:00:00.000Z",
        updatedAt: "2026-03-13T09:01:00.000Z",
      },
      {
        id: "7399dc95-9ab0-4526-abfa-5da78000b3ab",
        channelId: "f3d0fbec-f8a0-40ad-8e19-2370c6b99083",
        contactEmail: null,
        status: "failed",
        hubspotObjectId: null,
        errorMessage: "Channel has no contact email",
        createdAt: "2026-03-13T09:00:00.000Z",
        updatedAt: "2026-03-13T09:01:00.000Z",
      },
    ],
  };
}

function createSearchParams(
  input: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, item);
      }
      continue;
    }

    if (value !== undefined) {
      searchParams.set(key, value);
    }
  }

  return searchParams;
}

function createShellState(options?: {
  historyState?: HubspotPushManagerViewProps["historyState"];
  detailState?: HubspotPushManagerViewProps["detailState"];
  selectedBatchId?: string | null;
  historyReloadToken?: number;
  detailReloadToken?: number;
  isRefreshingHistory?: boolean;
  isRefreshingDetail?: boolean;
}) {
  return {
    historyState:
      options?.historyState ??
      {
        status: "loading" as const,
        items: [],
        error: null,
      },
    detailState:
      options?.detailState ??
      {
        requestState: "idle" as const,
        data: null,
        error: null,
      },
    selectedBatchId: options?.selectedBatchId ?? null,
    historyReloadToken: options?.historyReloadToken ?? 0,
    detailReloadToken: options?.detailReloadToken ?? 0,
    isRefreshingHistory: options?.isRefreshingHistory ?? false,
    isRefreshingDetail: options?.isRefreshingDetail ?? false,
  };
}

function renderShell(options?: {
  historyState?: HubspotPushManagerViewProps["historyState"];
  detailState?: HubspotPushManagerViewProps["detailState"];
  selectedBatchId?: string | null;
  historyReloadToken?: number;
  detailReloadToken?: number;
  isRefreshingHistory?: boolean;
  isRefreshingDetail?: boolean;
  runEffects?: boolean;
  searchParams?: URLSearchParams;
}) {
  const state = createShellState(options);
  const setters = {
    setHistoryState: vi.fn(),
    setDetailState: vi.fn(),
    setSelectedBatchId: vi.fn(),
    setHistoryReloadToken: vi.fn(),
    setDetailReloadToken: vi.fn(),
    setIsRefreshingHistory: vi.fn(),
    setIsRefreshingDetail: vi.fn(),
  };
  const cleanups: Array<() => void> = [];

  useStateMock.mockReset();
  useEffectMock.mockReset();
  replaceMock.mockReset();
  usePathnameMock.mockReturnValue("/hubspot");
  useRouterMock.mockReturnValue({
    replace: replaceMock,
  });
  useSearchParamsMock.mockReturnValue(options?.searchParams ?? createSearchParams({}));
  useStateMock
    .mockReturnValueOnce([state.historyState, setters.setHistoryState])
    .mockReturnValueOnce([state.detailState, setters.setDetailState])
    .mockReturnValueOnce([state.selectedBatchId, setters.setSelectedBatchId])
    .mockReturnValueOnce([state.historyReloadToken, setters.setHistoryReloadToken])
    .mockReturnValueOnce([state.detailReloadToken, setters.setDetailReloadToken])
    .mockReturnValueOnce([state.isRefreshingHistory, setters.setIsRefreshingHistory])
    .mockReturnValueOnce([state.isRefreshingDetail, setters.setIsRefreshingDetail]);
  useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
    if (options?.runEffects === false) {
      return;
    }

    const cleanup = effect();

    if (typeof cleanup === "function") {
      cleanups.push(cleanup);
    }
  });

  const element = HubspotPushManager() as HubspotPushManagerElement;

  return {
    cleanups,
    element,
    setters,
  };
}

describe("hubspot push manager behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchHubspotPushBatchesMock.mockResolvedValue([buildSummary()]);
    fetchHubspotPushBatchDetailMock.mockResolvedValue(buildDetail());
  });

  it("loads HubSpot push history on mount", async () => {
    const { setters } = renderShell();

    expect(fetchHubspotPushBatchesMock).toHaveBeenCalledWith(expect.any(AbortSignal));

    await Promise.resolve();
    await Promise.resolve();

    expect(setters.setHistoryState).toHaveBeenCalledWith({
      status: "ready",
      items: [buildSummary()],
      error: null,
    });
  });

  it("falls back to the newest batch when the URL does not provide batchId", () => {
    const firstBatch = buildSummary({
      id: "11111111-1111-4111-8111-111111111111",
    });
    const secondBatch = buildSummary({
      id: "22222222-2222-4222-8222-222222222222",
      status: "completed",
    });
    const { setters } = renderShell({
      historyState: {
        status: "ready",
        items: [firstBatch, secondBatch],
        error: null,
      },
      runEffects: true,
    });

    expect(setters.setSelectedBatchId).toHaveBeenCalledWith(firstBatch.id);
    expect(replaceMock).toHaveBeenCalledWith(`/hubspot?batchId=${firstBatch.id}`);
  });

  it("prefers the batchId from the URL when it matches a loaded batch", () => {
    const firstBatch = buildSummary({
      id: "11111111-1111-4111-8111-111111111111",
    });
    const secondBatch = buildSummary({
      id: "22222222-2222-4222-8222-222222222222",
      status: "completed",
    });
    const { setters } = renderShell({
      historyState: {
        status: "ready",
        items: [firstBatch, secondBatch],
        error: null,
      },
      searchParams: createSearchParams({
        batchId: secondBatch.id,
      }),
      runEffects: true,
      selectedBatchId: secondBatch.id,
    });

    expect(setters.setSelectedBatchId).toHaveBeenCalledWith(secondBatch.id);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("syncs the URL when the user selects a different batch", () => {
    const firstBatch = buildSummary({
      id: "11111111-1111-4111-8111-111111111111",
    });
    const secondBatch = buildSummary({
      id: "22222222-2222-4222-8222-222222222222",
      status: "completed",
    });
    const { element, setters } = renderShell({
      historyState: {
        status: "ready",
        items: [firstBatch, secondBatch],
        error: null,
      },
      runEffects: false,
      selectedBatchId: firstBatch.id,
    });

    element.props.onSelectBatch(secondBatch.id);

    expect(setters.setSelectedBatchId).toHaveBeenCalledWith(secondBatch.id);
    expect(replaceMock).toHaveBeenCalledWith(`/hubspot?batchId=${secondBatch.id}`);
  });

  it("polls both history and detail while queued or running work remains", () => {
    vi.useFakeTimers();

    try {
      const detail = buildDetail({
        id: "11111111-1111-4111-8111-111111111111",
        status: "queued",
      });
      const { setters } = renderShell({
        historyState: {
          status: "ready",
          items: [
            buildSummary({
              id: detail.id,
              status: "running",
            }),
          ],
          error: null,
        },
        detailState: {
          requestState: "ready",
          data: detail,
          error: null,
        },
        runEffects: true,
        searchParams: createSearchParams({
          batchId: detail.id,
        }),
        selectedBatchId: detail.id,
      });

      vi.advanceTimersByTime(HUBSPOT_PUSH_HISTORY_POLL_INTERVAL_MS);

      const historyUpdate = setters.setHistoryReloadToken.mock.calls[0]?.[0] as
        | ((current: number) => number)
        | undefined;
      const detailUpdate = setters.setDetailReloadToken.mock.calls[0]?.[0] as
        | ((current: number) => number)
        | undefined;

      expect(historyUpdate?.(0)).toBe(1);
      expect(detailUpdate?.(2)).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the current history visible when a refresh fails", async () => {
    const currentItems = [
      buildSummary({
        id: "11111111-1111-4111-8111-111111111111",
        status: "completed",
      }),
    ];
    fetchHubspotPushBatchesMock.mockRejectedValueOnce(new Error("History down"));
    const { setters } = renderShell({
      historyState: {
        status: "ready",
        items: currentItems,
        error: null,
      },
      runEffects: true,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(setters.setIsRefreshingHistory).toHaveBeenCalledWith(true);

    const historyUpdater = setters.setHistoryState.mock.calls.find(
      (call) => typeof call[0] === "function",
    )?.[0] as ((current: HubspotPushManagerViewProps["historyState"]) => HubspotPushManagerViewProps["historyState"]) | undefined;

    expect(
      historyUpdater?.({
        status: "ready",
        items: currentItems,
        error: null,
      }),
    ).toEqual({
      status: "ready",
      items: currentItems,
      error: "History down",
    });
  });

  it("keeps the current detail visible when a refresh fails", async () => {
    const detail = buildDetail({
      id: "11111111-1111-4111-8111-111111111111",
    });
    fetchHubspotPushBatchDetailMock.mockRejectedValueOnce(new Error("Detail down"));
    const { setters } = renderShell({
      historyState: {
        status: "ready",
        items: [
          buildSummary({
            id: detail.id,
            status: "completed",
            pushedRowCount: 1,
            failedRowCount: 1,
          }),
        ],
        error: null,
      },
      detailState: {
        requestState: "ready",
        data: detail,
        error: null,
      },
      runEffects: true,
      searchParams: createSearchParams({
        batchId: detail.id,
      }),
      selectedBatchId: detail.id,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(setters.setIsRefreshingDetail).toHaveBeenCalledWith(true);

    const detailUpdater = setters.setDetailState.mock.calls.find(
      (call) => typeof call[0] === "function",
    )?.[0] as ((current: HubspotPushManagerViewProps["detailState"]) => HubspotPushManagerViewProps["detailState"]) | undefined;

    expect(
      detailUpdater?.({
        requestState: "ready",
        data: detail,
        error: null,
      }),
    ).toEqual({
      requestState: "ready",
      data: detail,
      error: "Detail down",
    });
  });
});
