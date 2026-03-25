import type {
  HubspotImportBatchDetail,
  HubspotImportBatchSummary,
  HubspotPushBatchDetail,
  HubspotPushBatchSummary,
} from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchHubspotImportBatchesMock,
  fetchHubspotImportBatchDetailMock,
  fetchHubspotPushBatchesMock,
  fetchHubspotPushBatchDetailMock,
  replaceMock,
  useEffectMock,
  usePathnameMock,
  useRouterMock,
  useSearchParamsMock,
  useStateMock,
} = vi.hoisted(() => ({
  fetchHubspotImportBatchesMock: vi.fn(),
  fetchHubspotImportBatchDetailMock: vi.fn(),
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

vi.mock("../../lib/hubspot-import-batches-api", () => ({
  HubspotImportBatchesApiError: class HubspotImportBatchesApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "HubspotImportBatchesApiError";
      this.status = status;
    }
  },
  fetchHubspotImportBatchDetail: fetchHubspotImportBatchDetailMock,
  fetchHubspotImportBatches: fetchHubspotImportBatchesMock,
  getHubspotImportBatchDownloadUrl: (batchId: string) =>
    `/api/hubspot-import-batches/${encodeURIComponent(batchId)}/download`,
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
  fetchHubspotPushBatchDetail: fetchHubspotPushBatchDetailMock,
  fetchHubspotPushBatches: fetchHubspotPushBatchesMock,
}));

import {
  HUBSPOT_PUSH_HISTORY_POLL_INTERVAL_MS,
  HubspotPushManager,
  HubspotPushManagerView,
} from "./hubspot-push-manager";

type HubspotPushManagerViewProps = Parameters<typeof HubspotPushManagerView>[0];
type HubspotPushManagerElement = ReactElement<HubspotPushManagerViewProps>;

function buildImportSummary(
  overrides?: Partial<HubspotImportBatchSummary>,
): HubspotImportBatchSummary {
  return {
    id: "fdd240f2-ef31-43fe-b1d2-a584951654a8",
    run: {
      id: "57c8b6a1-85cf-4f51-a510-43fd61026f29",
      name: "Spring gaming outreach",
    },
    fileName: "spring-gaming-outreach-hubspot.csv",
    schemaVersion: "week7-hubspot-import-v1",
    status: "queued",
    totalRowCount: 2,
    preparedRowCount: 0,
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

function buildImportDetail(
  overrides?: Partial<HubspotImportBatchDetail>,
): HubspotImportBatchDetail {
  return {
    ...buildImportSummary({
      status: "completed",
      preparedRowCount: 1,
      failedRowCount: 1,
      completedAt: "2026-03-13T09:02:00.000Z",
      ...overrides,
    }),
    rows: [
      {
        id: "28ada809-e597-483e-9a7f-f568fc2f80dd",
        channelId: "14e40450-71c2-4e0e-a160-b787d21843fd",
        channelTitle: "Imported Creator",
        contactEmail: "creator@example.com",
        firstName: "Imported",
        lastName: "Creator",
        influencerType: "Creator",
        influencerVertical: "Gaming",
        countryRegion: "Germany",
        language: "German",
        status: "prepared",
        errorMessage: null,
        createdAt: "2026-03-13T09:00:00.000Z",
        updatedAt: "2026-03-13T09:01:00.000Z",
      },
    ],
  };
}

function buildLegacySummary(
  overrides?: Partial<HubspotPushBatchSummary>,
): HubspotPushBatchSummary {
  return {
    id: "afef11a2-ef31-43fe-b1d2-a584951654a8",
    status: "completed",
    totalRowCount: 2,
    pushedRowCount: 1,
    failedRowCount: 1,
    lastError: null,
    requestedBy: {
      id: "8c1136b4-1c95-4e8c-aefe-0e58df0a39d5",
      email: "manager@example.com",
      name: "Manager",
    },
    createdAt: "2026-03-12T09:00:00.000Z",
    updatedAt: "2026-03-12T09:02:00.000Z",
    startedAt: "2026-03-12T09:01:00.000Z",
    completedAt: "2026-03-12T09:02:00.000Z",
    ...overrides,
  };
}

function buildLegacyDetail(
  overrides?: Partial<HubspotPushBatchDetail>,
): HubspotPushBatchDetail {
  return {
    ...buildLegacySummary(overrides),
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
        createdAt: "2026-03-12T09:00:00.000Z",
        updatedAt: "2026-03-12T09:01:00.000Z",
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
    fetchHubspotImportBatchesMock.mockResolvedValue([buildImportSummary()]);
    fetchHubspotImportBatchDetailMock.mockResolvedValue(buildImportDetail());
    fetchHubspotPushBatchesMock.mockResolvedValue([buildLegacySummary()]);
    fetchHubspotPushBatchDetailMock.mockResolvedValue(buildLegacyDetail());
  });

  it("loads merged HubSpot history on mount", async () => {
    const importSummary = buildImportSummary();
    const legacySummary = buildLegacySummary();
    fetchHubspotImportBatchesMock.mockResolvedValueOnce([importSummary]);
    fetchHubspotPushBatchesMock.mockResolvedValueOnce([legacySummary]);

    const { setters } = renderShell();

    expect(fetchHubspotImportBatchesMock).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(fetchHubspotPushBatchesMock).toHaveBeenCalledWith(expect.any(AbortSignal));

    await Promise.resolve();
    await Promise.resolve();

    expect(setters.setHistoryState).toHaveBeenCalledWith({
      status: "ready",
      items: [
        { kind: "import", summary: importSummary },
        { kind: "legacy", summary: legacySummary },
      ],
      error: null,
    });
  });

  it("falls back to the first visible batch when the URL does not provide batchId", () => {
    const firstBatch = {
      kind: "import" as const,
      summary: buildImportSummary({
        id: "11111111-1111-4111-8111-111111111111",
      }),
    };
    const secondBatch = {
      kind: "legacy" as const,
      summary: buildLegacySummary({
        id: "22222222-2222-4222-8222-222222222222",
      }),
    };
    const { setters } = renderShell({
      historyState: {
        status: "ready",
        items: [firstBatch, secondBatch],
        error: null,
      },
      runEffects: true,
    });

    expect(setters.setSelectedBatchId).toHaveBeenCalledWith(firstBatch.summary.id);
    expect(replaceMock).toHaveBeenCalledWith(`/hubspot?batchId=${firstBatch.summary.id}`);
  });

  it("prefers the batchId from the URL when it matches a loaded batch", () => {
    const firstBatch = {
      kind: "import" as const,
      summary: buildImportSummary({
        id: "11111111-1111-4111-8111-111111111111",
      }),
    };
    const secondBatch = {
      kind: "legacy" as const,
      summary: buildLegacySummary({
        id: "22222222-2222-4222-8222-222222222222",
      }),
    };
    const { setters } = renderShell({
      historyState: {
        status: "ready",
        items: [firstBatch, secondBatch],
        error: null,
      },
      searchParams: createSearchParams({
        batchId: secondBatch.summary.id,
      }),
      runEffects: true,
      selectedBatchId: secondBatch.summary.id,
    });

    expect(setters.setSelectedBatchId).toHaveBeenCalledWith(secondBatch.summary.id);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("syncs the URL when the user selects a different batch", () => {
    const firstBatch = {
      kind: "import" as const,
      summary: buildImportSummary({
        id: "11111111-1111-4111-8111-111111111111",
      }),
    };
    const secondBatch = {
      kind: "legacy" as const,
      summary: buildLegacySummary({
        id: "22222222-2222-4222-8222-222222222222",
      }),
    };
    const { element, setters } = renderShell({
      historyState: {
        status: "ready",
        items: [firstBatch, secondBatch],
        error: null,
      },
      runEffects: false,
      selectedBatchId: firstBatch.summary.id,
    });

    element.props.onSelectBatch(secondBatch.summary.id);

    expect(setters.setSelectedBatchId).toHaveBeenCalledWith(secondBatch.summary.id);
    expect(replaceMock).toHaveBeenCalledWith(`/hubspot?batchId=${secondBatch.summary.id}`);
  });

  it("schedules background refresh while queued or running work remains", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    try {
      const batchId = "11111111-1111-4111-8111-111111111111";
      const detail = buildImportDetail({
        id: batchId,
        status: "queued",
      });
      fetchHubspotImportBatchDetailMock.mockResolvedValue(detail);

      const { setters } = renderShell({
        historyState: {
          status: "ready",
          items: [
            {
              kind: "import",
              summary: buildImportSummary({
                id: batchId,
                status: "running",
              }),
            },
          ],
          error: null,
        },
        detailState: {
          requestState: "ready",
          data: {
            kind: "import",
            batch: detail,
          },
          error: null,
        },
        runEffects: true,
        searchParams: createSearchParams({
          batchId,
        }),
        selectedBatchId: batchId,
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        HUBSPOT_PUSH_HISTORY_POLL_INTERVAL_MS,
      );

      vi.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();

      expect(setters.setIsRefreshingHistory).toHaveBeenCalledWith(true);
      expect(setters.setIsRefreshingDetail).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps history available when one source refresh fails", async () => {
    const currentLegacy = buildLegacySummary({
      id: "11111111-1111-4111-8111-111111111111",
    });
    fetchHubspotImportBatchesMock.mockRejectedValueOnce(new Error("Imports down"));
    fetchHubspotPushBatchesMock.mockResolvedValueOnce([currentLegacy]);

    const { setters } = renderShell({
      historyState: {
        status: "ready",
        items: [{ kind: "legacy", summary: currentLegacy }],
        error: null,
      },
      runEffects: true,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(setters.setHistoryState).toHaveBeenLastCalledWith({
      status: "ready",
      items: [{ kind: "legacy", summary: currentLegacy }],
      error: "Imports down",
    });
  });

  it("keeps the current detail visible when a refresh fails", async () => {
    const detail = buildImportDetail({
      id: "11111111-1111-4111-8111-111111111111",
    });
    fetchHubspotImportBatchDetailMock.mockRejectedValueOnce(new Error("Detail down"));
    const { setters } = renderShell({
      historyState: {
        status: "ready",
        items: [
          {
            kind: "import",
            summary: buildImportSummary({
              id: detail.id,
            }),
          },
        ],
        error: null,
      },
      detailState: {
        requestState: "ready",
        data: {
          kind: "import",
          batch: detail,
        },
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

    const detailUpdater = setters.setDetailState.mock.calls
      .filter((call) => typeof call[0] === "function")
      .at(-1)?.[0] as
      | ((
          current: HubspotPushManagerViewProps["detailState"],
        ) => HubspotPushManagerViewProps["detailState"])
      | undefined;

    expect(
      detailUpdater?.({
        requestState: "ready",
        data: {
          kind: "import",
          batch: detail,
        },
        error: null,
      }),
    ).toEqual({
      requestState: "ready",
      data: {
        kind: "import",
        batch: detail,
      },
      error: "Detail down",
    });
  });

  it("loads legacy detail when the selected history item is a Week 6 fallback", () => {
    const legacySummary = buildLegacySummary({
      id: "22222222-2222-4222-8222-222222222222",
    });

    renderShell({
      historyState: {
        status: "ready",
        items: [{ kind: "legacy", summary: legacySummary }],
        error: null,
      },
      runEffects: true,
      searchParams: createSearchParams({
        batchId: legacySummary.id,
      }),
      selectedBatchId: legacySummary.id,
    });

    expect(fetchHubspotPushBatchDetailMock).toHaveBeenCalledWith(
      legacySummary.id,
      expect.any(AbortSignal),
    );
  });
});
