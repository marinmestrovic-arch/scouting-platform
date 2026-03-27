import type { ListChannelsResponse, SegmentResponse } from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createCsvExportBatchMock,
  createHubspotPushBatchMock,
  createSavedSegmentMock,
  deleteSavedSegmentMock,
  fetchChannelsMock,
  fetchCsvExportBatchDetailMock,
  fetchSavedSegmentsMock,
  fetchHubspotPushBatchDetailMock,
  requestChannelEnrichmentBatchMock,
  replaceMock,
  useEffectMock,
  usePathnameMock,
  useRouterMock,
  useSearchParamsMock,
  useStateMock,
} = vi.hoisted(() => ({
  createCsvExportBatchMock: vi.fn(),
  createHubspotPushBatchMock: vi.fn(),
  createSavedSegmentMock: vi.fn(),
  deleteSavedSegmentMock: vi.fn(),
  fetchChannelsMock: vi.fn(),
  fetchCsvExportBatchDetailMock: vi.fn(),
  fetchSavedSegmentsMock: vi.fn(),
  fetchHubspotPushBatchDetailMock: vi.fn(),
  requestChannelEnrichmentBatchMock: vi.fn(),
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

vi.mock("../../lib/channels-api", () => ({
  fetchChannels: fetchChannelsMock,
  requestChannelEnrichmentBatch: requestChannelEnrichmentBatchMock,
}));

vi.mock("../../lib/csv-export-batches-api", () => ({
  createCsvExportBatch: createCsvExportBatchMock,
  fetchCsvExportBatchDetail: fetchCsvExportBatchDetailMock,
  getCsvExportBatchDownloadUrl: vi.fn((batchId: string) => `/api/csv-export-batches/${batchId}/download`),
}));

vi.mock("../../lib/hubspot-push-batches-api", () => ({
  createHubspotPushBatch: createHubspotPushBatchMock,
  fetchHubspotPushBatchDetail: fetchHubspotPushBatchDetailMock,
}));

vi.mock("../../lib/segments-api", () => ({
  createSavedSegment: createSavedSegmentMock,
  deleteSavedSegment: deleteSavedSegmentMock,
  fetchSavedSegments: fetchSavedSegmentsMock,
}));

import {
  CATALOG_BATCH_STATUS_POLL_INTERVAL_MS,
  CATALOG_ENRICHMENT_POLL_INTERVAL_MS,
  CatalogTableShell,
} from "./catalog-table-shell";

type CatalogShellElement = ReactElement<{
  onApplyFilters: () => void;
  onClearSelection: () => void;
  onCreateSegment: () => Promise<void> | void;
  onDeleteSegment: (segment: SegmentResponse) => Promise<void> | void;
  onExportSelectedChannels: () => Promise<void> | void;
  onLoadSegment: (segment: SegmentResponse) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onPushSelectedChannelsToHubspot: () => Promise<void> | void;
  onRequestSelectedEnrichment: () => Promise<void> | void;
  onResetFilters: () => void;
  onRetry: () => void;
  onRetrySavedSegments: () => void;
  onDraftQueryChange: (value: string) => void;
  onToggleChannelSelection: (channelId: string) => void;
  onToggleEnrichmentStatus: (value: "completed" | "failed") => void;
  onTogglePageSelection: () => void;
  draftFilters: {
    query: string;
    enrichmentStatus: string[];
    advancedReportStatus: string[];
  };
  requestState: {
    status: "loading" | "error" | "ready";
  };
  savedSegmentName: string;
  hasPendingFilterChanges: boolean;
  selectedChannelIds: string[];
}>;

type SavedSegmentsRequestState =
  | {
      status: "loading";
      error: null;
    }
  | {
      status: "error";
      error: string;
    }
  | {
      status: "ready";
      error: null;
    };

type SavedSegmentOperationStatus = {
  type: "idle" | "success" | "error";
  message: string;
};

type BatchEnrichmentActionState = {
  type: "idle" | "submitting" | "success" | "error";
  message: string;
};

type CatalogCsvExportBatchState = {
  requestState: "idle" | "loading" | "ready" | "error";
  summary: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
  error: string | null;
  isRefreshing: boolean;
};

type CatalogHubspotPushBatchState = {
  requestState: "idle" | "loading" | "ready" | "error";
  summary: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
  error: string | null;
  isRefreshing: boolean;
};

function createReadyState(overrides: Partial<ListChannelsResponse>): {
  status: "ready";
  data: ListChannelsResponse;
  error: null;
} {
  return {
    status: "ready",
    data: {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      ...overrides,
    },
    error: null,
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

function createSavedSegment(overrides?: Partial<SegmentResponse>): SegmentResponse {
  return {
    id: "33402e7e-e5c8-41e8-b94a-a4086ef0f6af",
    name: "Space creators",
    filters: {
      query: "space",
      enrichmentStatus: ["completed"],
      advancedReportStatus: ["pending_approval"],
    },
    createdAt: "2026-03-08T10:00:00.000Z",
    updatedAt: "2026-03-08T10:00:00.000Z",
    ...overrides,
  };
}

function createChannel(
  id: string,
  title: string,
  enrichmentOverrides?: Partial<{
    status: "missing" | "queued" | "running" | "completed" | "failed" | "stale";
    updatedAt: string | null;
    completedAt: string | null;
    lastError: string | null;
  }>,
) {
  return {
    id,
    youtubeChannelId: `UC_${title.toUpperCase().replace(/\s+/g, "_")}`,
    title,
    handle: `@${title.toLowerCase().replace(/\s+/g, "")}`,
    thumbnailUrl: null,
    enrichment: {
      status: "missing" as const,
      updatedAt: null,
      completedAt: null,
      lastError: null,
      ...enrichmentOverrides,
    },
    advancedReport: {
      requestId: null,
      status: "missing" as const,
      updatedAt: null,
      completedAt: null,
      lastError: null,
    },
  };
}

function createCsvExportBatchSummary(overrides?: Record<string, unknown>) {
  return {
    id: "99d39ccb-3cf5-4f09-a647-a0e1387d31cb",
    scopeType: "selected",
    fileName: "creator-export.csv",
    schemaVersion: "v1",
    status: "queued",
    rowCount: 0,
    lastError: null,
    requestedBy: {
      id: "58825d8b-f806-4480-b23d-b23773cde596",
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

function createCsvExportBatchDetail(overrides?: Record<string, unknown>) {
  return {
    ...createCsvExportBatchSummary(),
    scope: {
      type: "selected",
      channelIds: ["14e40450-71c2-4e0e-a160-b787d21843fd"],
    },
    ...overrides,
  };
}

function createHubspotPushBatchSummary(overrides?: Record<string, unknown>) {
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

function createHubspotPushBatchDetail(overrides?: Record<string, unknown>) {
  return {
    ...createHubspotPushBatchSummary(),
    scope: {
      channelIds: ["14e40450-71c2-4e0e-a160-b787d21843fd"],
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
    ],
    ...overrides,
  };
}

function renderShell(options?: {
  requestState?: ReturnType<typeof createReadyState> | {
    status: "loading";
    data: null;
    error: null;
  } | {
    status: "error";
    data: null;
    error: string;
  };
  searchParams?: URLSearchParams;
  draftFilters?: {
    query: string;
    enrichmentStatus: string[];
    advancedReportStatus: string[];
  };
  reloadToken?: number;
  savedSegments?: SegmentResponse[];
  savedSegmentsRequestState?: SavedSegmentsRequestState;
  savedSegmentsReloadToken?: number;
  savedSegmentName?: string;
  savedSegmentOperationStatus?: SavedSegmentOperationStatus;
  pendingSegmentAction?: string | null;
  selectedChannelIds?: string[];
  batchEnrichmentActionState?: BatchEnrichmentActionState;
  latestCsvExportBatch?: CatalogCsvExportBatchState;
  latestCsvExportBatchReloadToken?: number;
  latestHubspotPushBatch?: CatalogHubspotPushBatchState;
  latestHubspotPushBatchReloadToken?: number;
}) {
  const setDraftFilters = vi.fn();
  const setRequestState = vi.fn();
  const setReloadToken = vi.fn();
  const setSavedSegments = vi.fn();
  const setSavedSegmentsRequestState = vi.fn();
  const setSavedSegmentsReloadToken = vi.fn();
  const setSavedSegmentName = vi.fn();
  const setSavedSegmentOperationStatus = vi.fn();
  const setPendingSegmentAction = vi.fn();
  const setSelectedChannelIds = vi.fn();
  const setBatchEnrichmentActionState = vi.fn();
  const setLatestCsvExportBatch = vi.fn();
  const setLatestCsvExportBatchReloadToken = vi.fn();
  const setLatestHubspotPushBatch = vi.fn();
  const setLatestHubspotPushBatchReloadToken = vi.fn();
  const cleanups: Array<() => void> = [];

  useStateMock.mockReset();
  useEffectMock.mockReset();
  replaceMock.mockReset();
  usePathnameMock.mockReturnValue("/catalog");
  useRouterMock.mockReturnValue({
    replace: replaceMock,
  });
  useSearchParamsMock.mockReturnValue(
    options?.searchParams ??
      createSearchParams({ page: "2", query: "space", enrichmentStatus: ["failed"] }),
  );

  useStateMock
    .mockReturnValueOnce([
      options?.draftFilters ?? {
        query: "space",
        enrichmentStatus: ["failed"],
        advancedReportStatus: [],
      },
      setDraftFilters,
    ])
    .mockReturnValueOnce([
      options?.requestState ??
        createReadyState({
          total: 21,
          page: 2,
          pageSize: 20,
        }),
      setRequestState,
    ])
    .mockReturnValueOnce([options?.reloadToken ?? 0, setReloadToken])
    .mockReturnValueOnce([options?.savedSegments ?? [], setSavedSegments])
    .mockReturnValueOnce([
      options?.savedSegmentsRequestState ?? {
        status: "loading",
        error: null,
      },
      setSavedSegmentsRequestState,
    ])
    .mockReturnValueOnce([options?.savedSegmentsReloadToken ?? 0, setSavedSegmentsReloadToken])
    .mockReturnValueOnce([options?.savedSegmentName ?? "", setSavedSegmentName])
    .mockReturnValueOnce([
      options?.savedSegmentOperationStatus ?? {
        type: "idle",
        message: "",
      },
      setSavedSegmentOperationStatus,
    ])
    .mockReturnValueOnce([options?.pendingSegmentAction ?? null, setPendingSegmentAction])
    .mockReturnValueOnce([options?.selectedChannelIds ?? [], setSelectedChannelIds])
    .mockReturnValueOnce([
      options?.batchEnrichmentActionState ?? {
        type: "idle",
        message: "",
      },
      setBatchEnrichmentActionState,
    ])
    .mockReturnValueOnce([
      options?.latestCsvExportBatch ?? {
        requestState: "idle",
        summary: null,
        detail: null,
        error: null,
        isRefreshing: false,
      },
      setLatestCsvExportBatch,
    ])
    .mockReturnValueOnce([
      options?.latestCsvExportBatchReloadToken ?? 0,
      setLatestCsvExportBatchReloadToken,
    ])
    .mockReturnValueOnce([
      options?.latestHubspotPushBatch ?? {
        requestState: "idle",
        summary: null,
        detail: null,
        error: null,
        isRefreshing: false,
      },
      setLatestHubspotPushBatch,
    ])
    .mockReturnValueOnce([
      options?.latestHubspotPushBatchReloadToken ?? 0,
      setLatestHubspotPushBatchReloadToken,
    ]);

  useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
    const maybeCleanup = effect();

    if (typeof maybeCleanup === "function") {
      cleanups.push(maybeCleanup);
    }
  });

  const element = CatalogTableShell({}) as CatalogShellElement;

  return {
    cleanups,
    element,
    setDraftFilters,
    setPendingSegmentAction,
    setReloadToken,
    setRequestState,
    setBatchEnrichmentActionState,
    setLatestCsvExportBatch,
    setLatestCsvExportBatchReloadToken,
    setLatestHubspotPushBatch,
    setLatestHubspotPushBatchReloadToken,
    setSavedSegmentName,
    setSavedSegmentOperationStatus,
    setSelectedChannelIds,
    setSavedSegments,
    setSavedSegmentsReloadToken,
    setSavedSegmentsRequestState,
  };
}

describe("catalog table shell behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchChannelsMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } satisfies ListChannelsResponse);
    createCsvExportBatchMock.mockResolvedValue(createCsvExportBatchSummary());
    fetchCsvExportBatchDetailMock.mockResolvedValue(createCsvExportBatchDetail());
    fetchSavedSegmentsMock.mockResolvedValue([createSavedSegment()]);
    createHubspotPushBatchMock.mockResolvedValue(createHubspotPushBatchSummary());
    fetchHubspotPushBatchDetailMock.mockResolvedValue(createHubspotPushBatchDetail());
    requestChannelEnrichmentBatchMock.mockResolvedValue([]);
  });

  it("loads the current URL-backed page and saved segments on mount", async () => {
    const channelResponse: ListChannelsResponse = {
      items: [],
      total: 1,
      page: 2,
      pageSize: 20,
    };
    const savedSegment = createSavedSegment();

    fetchChannelsMock.mockResolvedValueOnce(channelResponse);
    fetchSavedSegmentsMock.mockResolvedValueOnce([savedSegment]);

    const {
      cleanups,
      setDraftFilters,
      setRequestState,
      setSavedSegments,
      setSavedSegmentsRequestState,
    } = renderShell();

    const setDraftFiltersUpdater = setDraftFilters.mock.calls[0]?.[0] as
      | ((current: {
          query: string;
          enrichmentStatus: string[];
          advancedReportStatus: string[];
        }) => {
          query: string;
          enrichmentStatus: string[];
          advancedReportStatus: string[];
        })
      | undefined;

    expect(
      setDraftFiltersUpdater?.({
        query: "",
        enrichmentStatus: [],
        advancedReportStatus: [],
      }),
    ).toEqual({
      query: "space",
      enrichmentStatus: ["failed"],
      advancedReportStatus: [],
    });
    expect(fetchChannelsMock).toHaveBeenCalledWith(
      {
        page: 2,
        pageSize: 20,
        query: "space",
        enrichmentStatus: ["failed"],
      },
      expect.any(AbortSignal),
    );
    expect(fetchSavedSegmentsMock).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(setRequestState).toHaveBeenNthCalledWith(1, {
      status: "loading",
      data: null,
      error: null,
    });
    expect(setSavedSegmentsRequestState).toHaveBeenNthCalledWith(1, {
      status: "loading",
      error: null,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenNthCalledWith(2, {
      status: "ready",
      data: channelResponse,
      error: null,
    });
    expect(setSavedSegments).toHaveBeenCalledWith([savedSegment]);
    expect(setSavedSegmentsRequestState).toHaveBeenNthCalledWith(2, {
      status: "ready",
      error: null,
    });

    const channelSignal = fetchChannelsMock.mock.calls[0]?.[1] as AbortSignal | undefined;
    const segmentSignal = fetchSavedSegmentsMock.mock.calls[0]?.[0] as AbortSignal | undefined;

    expect(channelSignal?.aborted).toBe(false);
    expect(segmentSignal?.aborted).toBe(false);

    cleanups.forEach((cleanup) => {
      cleanup();
    });

    expect(channelSignal?.aborted).toBe(true);
    expect(segmentSignal?.aborted).toBe(true);
  });

  it("polls quietly while visible enrichment jobs are active", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
      void handler();
      return 321 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);
    const runningResponse: ListChannelsResponse = {
      items: [
        createChannel("00000000-0000-0000-0000-000000000301", "Orbit Lab", {
          status: "running",
          updatedAt: "2026-03-08T10:00:00.000Z",
          completedAt: null,
          lastError: null,
        }),
      ],
      total: 1,
      page: 2,
      pageSize: 20,
    };
    const completedResponse: ListChannelsResponse = {
      items: [
        createChannel("00000000-0000-0000-0000-000000000301", "Orbit Lab", {
          status: "completed",
          updatedAt: "2026-03-08T10:00:00.000Z",
          completedAt: "2026-03-08T10:05:00.000Z",
          lastError: null,
        }),
      ],
      total: 1,
      page: 2,
      pageSize: 20,
    };

    try {
      fetchChannelsMock.mockResolvedValueOnce(runningResponse);
      fetchChannelsMock.mockResolvedValueOnce(completedResponse);

      const { cleanups, setRequestState } = renderShell();

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(fetchChannelsMock).toHaveBeenCalledTimes(2);
      expect(setRequestState).toHaveBeenNthCalledWith(1, {
        status: "loading",
        data: null,
        error: null,
      });
      expect(setRequestState).toHaveBeenNthCalledWith(2, {
        status: "ready",
        data: runningResponse,
        error: null,
      });
      expect(setRequestState).toHaveBeenNthCalledWith(3, {
        status: "ready",
        data: completedResponse,
        error: null,
      });
      expect(setRequestState).toHaveBeenCalledTimes(3);
      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        CATALOG_ENRICHMENT_POLL_INTERVAL_MS,
      );

      cleanups.forEach((cleanup) => {
        cleanup();
      });

      expect(clearTimeoutSpy).toHaveBeenCalledWith(321);
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  it("does not start polling when visible rows are already in terminal enrichment states", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    try {
      fetchChannelsMock.mockResolvedValueOnce({
        items: [
          createChannel("00000000-0000-0000-0000-000000000302", "Terminal Orbit", {
            status: "completed",
            updatedAt: "2026-03-08T10:00:00.000Z",
            completedAt: "2026-03-08T10:05:00.000Z",
            lastError: null,
          }),
        ],
        total: 1,
        page: 2,
        pageSize: 20,
      });

      renderShell();

      await Promise.resolve();
      await Promise.resolve();

      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("clears pending enrichment polling and aborts the latest catalog request on cleanup", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(() => {
      return 654 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    try {
      fetchChannelsMock.mockResolvedValueOnce({
        items: [
          createChannel("00000000-0000-0000-0000-000000000303", "Queued Orbit", {
            status: "queued",
            updatedAt: "2026-03-08T10:00:00.000Z",
            completedAt: null,
            lastError: null,
          }),
        ],
        total: 1,
        page: 2,
        pageSize: 20,
      });

      const { cleanups } = renderShell();

      await Promise.resolve();
      await Promise.resolve();

      const channelSignal = fetchChannelsMock.mock.calls[0]?.[1] as AbortSignal | undefined;

      cleanups.forEach((cleanup) => {
        cleanup();
      });

      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        CATALOG_ENRICHMENT_POLL_INTERVAL_MS,
      );
      expect(channelSignal?.aborted).toBe(true);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(654);
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  it("applies draft filters by replacing the URL and resetting to page 1", () => {
    const { element } = renderShell({
      draftFilters: {
        query: "mars",
        enrichmentStatus: ["completed"],
        advancedReportStatus: ["pending_approval"],
      },
    });

    element.props.onApplyFilters();

    expect(replaceMock).toHaveBeenCalledWith(
      "/catalog?page=1&query=mars&enrichmentStatus=completed&advancedReportStatus=pending_approval",
    );
  });

  it("loads a saved segment back into draft filters and URL state", () => {
    const { element, setDraftFilters, setSavedSegmentName, setSavedSegmentOperationStatus } =
      renderShell();
    const segment = createSavedSegment({
      name: "Launch channels",
      filters: {
        query: "launch",
        enrichmentStatus: ["completed"],
      },
    });

    setDraftFilters.mockClear();
    setSavedSegmentName.mockClear();
    setSavedSegmentOperationStatus.mockClear();

    element.props.onLoadSegment(segment);

    expect(setDraftFilters).toHaveBeenCalledWith({
      query: "launch",
      enrichmentStatus: ["completed"],
      advancedReportStatus: [],
    });
    expect(setSavedSegmentName).toHaveBeenCalledWith("Launch channels");
    expect(setSavedSegmentOperationStatus).toHaveBeenCalledWith({
      type: "success",
      message: 'Loaded segment "Launch channels".',
    });
    expect(replaceMock).toHaveBeenCalledWith(
      "/catalog?page=1&query=launch&enrichmentStatus=completed",
    );
  });

  it("creates a saved segment from the current draft filters", async () => {
    const createdSegment = createSavedSegment();
    createSavedSegmentMock.mockResolvedValueOnce(createdSegment);

    const {
      element,
      setPendingSegmentAction,
      setSavedSegmentName,
      setSavedSegmentOperationStatus,
      setSavedSegments,
    } = renderShell({
      draftFilters: {
        query: "space",
        enrichmentStatus: ["completed"],
        advancedReportStatus: [],
      },
      savedSegmentName: "  Space creators  ",
    });

    await Promise.resolve();
    await Promise.resolve();

    setPendingSegmentAction.mockClear();
    setSavedSegmentName.mockClear();
    setSavedSegmentOperationStatus.mockClear();
    setSavedSegments.mockClear();

    await element.props.onCreateSegment();

    expect(createSavedSegmentMock).toHaveBeenCalledWith({
      name: "Space creators",
      filters: {
        query: "space",
        enrichmentStatus: ["completed"],
      },
    });
    expect(setPendingSegmentAction).toHaveBeenNthCalledWith(1, "create");
    expect(setPendingSegmentAction).toHaveBeenLastCalledWith(null);
    expect(setSavedSegmentName).toHaveBeenCalledWith("");
    expect(setSavedSegmentOperationStatus).toHaveBeenLastCalledWith({
      type: "success",
      message: 'Saved segment "Space creators".',
    });

    const updateSavedSegments = setSavedSegments.mock.calls.at(-1)?.[0] as
      | ((current: SegmentResponse[]) => SegmentResponse[])
      | undefined;

    expect(updateSavedSegments?.([])).toEqual([createdSegment]);
  });

  it("deletes a saved segment and removes it from local state", async () => {
    const segment = createSavedSegment();
    deleteSavedSegmentMock.mockResolvedValueOnce(undefined);

    const {
      element,
      setPendingSegmentAction,
      setSavedSegmentOperationStatus,
      setSavedSegments,
    } = renderShell({
      savedSegments: [segment],
      savedSegmentsRequestState: {
        status: "ready",
        error: null,
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    setPendingSegmentAction.mockClear();
    setSavedSegmentOperationStatus.mockClear();
    setSavedSegments.mockClear();

    await element.props.onDeleteSegment(segment);

    expect(deleteSavedSegmentMock).toHaveBeenCalledWith(segment.id);
    expect(setPendingSegmentAction).toHaveBeenNthCalledWith(1, `delete:${segment.id}`);
    expect(setPendingSegmentAction).toHaveBeenLastCalledWith(null);
    expect(setSavedSegmentOperationStatus).toHaveBeenLastCalledWith({
      type: "success",
      message: 'Deleted segment "Space creators".',
    });

    const updateSavedSegments = setSavedSegments.mock.calls.at(-1)?.[0] as
      | ((current: SegmentResponse[]) => SegmentResponse[])
      | undefined;

    expect(updateSavedSegments?.([segment])).toEqual([]);
  });

  it("preserves active filters while paging forward and backward", () => {
    const first = renderShell({
      searchParams: createSearchParams({ page: "1", query: "space", enrichmentStatus: ["failed"] }),
      requestState: createReadyState({
        total: 21,
        page: 1,
        pageSize: 20,
      }),
    });
    first.element.props.onNextPage();

    expect(replaceMock).toHaveBeenCalledWith("/catalog?page=2&query=space&enrichmentStatus=failed");

    replaceMock.mockReset();

    const second = renderShell({
      searchParams: createSearchParams({ page: "2", query: "space", enrichmentStatus: ["failed"] }),
      requestState: createReadyState({
        total: 21,
        page: 2,
        pageSize: 20,
      }),
    });
    second.element.props.onPreviousPage();

    expect(replaceMock).toHaveBeenCalledWith("/catalog?page=1&query=space&enrichmentStatus=failed");
  });

  it("retries both channel and saved segment loads by bumping reload tokens", () => {
    const { element, setReloadToken, setSavedSegmentsReloadToken } = renderShell({
      requestState: {
        status: "error",
        data: null,
        error: "Unable to load channels. Please try again.",
      },
      savedSegmentsRequestState: {
        status: "error",
        error: "Unable to manage saved segments. Please try again.",
      },
    });

    element.props.onRetry();
    element.props.onRetrySavedSegments();

    const updateReloadToken = setReloadToken.mock.calls[0]?.[0] as
      | ((current: number) => number)
      | undefined;
    const updateSavedSegmentsReloadToken = setSavedSegmentsReloadToken.mock.calls[0]?.[0] as
      | ((current: number) => number)
      | undefined;

    expect(updateReloadToken?.(0)).toBe(1);
    expect(updateSavedSegmentsReloadToken?.(0)).toBe(1);
  });

  it("toggles individual channel selection without disturbing existing selections", () => {
    const channel = createChannel("00000000-0000-0000-0000-000000000101", "Orbit Lab");
    const { element, setSelectedChannelIds } = renderShell({
      requestState: createReadyState({
        items: [channel],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
      selectedChannelIds: ["sticky-selection"],
    });

    element.props.onToggleChannelSelection(channel.id);

    const updateSelectedChannelIds = setSelectedChannelIds.mock.calls[0]?.[0] as
      | ((current: string[]) => string[])
      | undefined;

    expect(updateSelectedChannelIds?.(["sticky-selection"])).toEqual([
      "sticky-selection",
      channel.id,
    ]);
  });

  it("selects and clears the current page without losing selections on other pages", () => {
    const firstChannel = createChannel("00000000-0000-0000-0000-000000000201", "Luna One");
    const secondChannel = createChannel("00000000-0000-0000-0000-000000000202", "Luna Two");
    const pageItems = [firstChannel, secondChannel];
    const initialSelection = ["sticky-selection"];
    const withPageSelected = [...initialSelection, firstChannel.id, secondChannel.id];

    const selectPage = renderShell({
      requestState: createReadyState({
        items: pageItems,
        total: 2,
        page: 1,
        pageSize: 20,
      }),
      selectedChannelIds: initialSelection,
    });

    selectPage.element.props.onTogglePageSelection();

    const selectPageUpdate = selectPage.setSelectedChannelIds.mock.calls[0]?.[0] as
      | ((current: string[]) => string[])
      | undefined;

    expect(selectPageUpdate?.(initialSelection)).toEqual(withPageSelected);

    const clearPage = renderShell({
      requestState: createReadyState({
        items: pageItems,
        total: 2,
        page: 1,
        pageSize: 20,
      }),
      selectedChannelIds: withPageSelected,
    });

    clearPage.element.props.onTogglePageSelection();

    const clearPageUpdate = clearPage.setSelectedChannelIds.mock.calls[0]?.[0] as
      | ((current: string[]) => string[])
      | undefined;

    expect(clearPageUpdate?.(withPageSelected)).toEqual(initialSelection);
  });

  it("clears all selected channels explicitly", () => {
    const { element, setSelectedChannelIds } = renderShell({
      selectedChannelIds: ["one", "two"],
    });

    element.props.onClearSelection();

    expect(setSelectedChannelIds).toHaveBeenCalledWith([]);
  });

  it("requests enrichment for all selected channels and refreshes visible rows", async () => {
    const selectedVisibleChannel = createChannel(
      "00000000-0000-0000-0000-000000000401",
      "Orbit Lab",
    );
    const selectedHiddenChannelId = "00000000-0000-0000-0000-000000000402";
    requestChannelEnrichmentBatchMock.mockResolvedValueOnce([
      {
        channelId: selectedVisibleChannel.id,
        ok: true,
        enrichment: {
          status: "queued",
          updatedAt: "2026-03-11T09:00:00.000Z",
          completedAt: null,
          lastError: null,
          summary: null,
          topics: null,
          brandFitNotes: null,
          confidence: null,
        },
      },
      {
        channelId: selectedHiddenChannelId,
        ok: true,
        enrichment: {
          status: "running",
          updatedAt: "2026-03-11T09:01:00.000Z",
          completedAt: null,
          lastError: null,
          summary: null,
          topics: null,
          brandFitNotes: null,
          confidence: null,
        },
      },
    ]);

    const { element, setBatchEnrichmentActionState, setReloadToken, setRequestState } = renderShell({
      requestState: createReadyState({
        items: [selectedVisibleChannel],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
      selectedChannelIds: [selectedVisibleChannel.id, selectedHiddenChannelId],
    });

    await Promise.resolve();
    await Promise.resolve();

    setBatchEnrichmentActionState.mockClear();
    setReloadToken.mockClear();
    setRequestState.mockClear();

    await element.props.onRequestSelectedEnrichment();

    expect(requestChannelEnrichmentBatchMock).toHaveBeenCalledWith([
      selectedVisibleChannel.id,
      selectedHiddenChannelId,
    ]);
    expect(setBatchEnrichmentActionState).toHaveBeenNthCalledWith(1, {
      type: "submitting",
      message: "Requesting enrichment for 2 channels.",
    });
    expect(setBatchEnrichmentActionState).toHaveBeenNthCalledWith(2, {
      type: "success",
      message:
        "Queued 1 channel for enrichment. 1 channel already running. The table refreshes automatically while jobs run.",
    });

    const updateRequestState = setRequestState.mock.calls[0]?.[0] as
      | ((current: ReturnType<typeof createReadyState>) => ReturnType<typeof createReadyState>)
      | undefined;
    const updatedRequestState = updateRequestState?.(
      createReadyState({
        items: [selectedVisibleChannel],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    );
    const updateReloadToken = setReloadToken.mock.calls[0]?.[0] as
      | ((current: number) => number)
      | undefined;

    expect(updatedRequestState).toEqual(
      createReadyState({
        items: [
          {
            ...selectedVisibleChannel,
            enrichment: {
              status: "queued",
              updatedAt: "2026-03-11T09:00:00.000Z",
              completedAt: null,
              lastError: null,
            },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    );
    expect(updateReloadToken?.(0)).toBe(1);
  });

  it("surfaces partial batch enrichment failures without losing successful requests", async () => {
    const selectedChannel = createChannel(
      "00000000-0000-0000-0000-000000000501",
      "Launch Pad",
    );
    requestChannelEnrichmentBatchMock.mockResolvedValueOnce([
      {
        channelId: selectedChannel.id,
        ok: true,
        enrichment: {
          status: "queued",
          updatedAt: null,
          completedAt: null,
          lastError: null,
          summary: null,
          topics: null,
          brandFitNotes: null,
          confidence: null,
        },
      },
      {
        channelId: "00000000-0000-0000-0000-000000000502",
        ok: false,
        error: new Error("Assigned YouTube API key is required before requesting enrichment"),
      },
    ]);

    const { element, setBatchEnrichmentActionState, setReloadToken } = renderShell({
      requestState: createReadyState({
        items: [selectedChannel],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
      selectedChannelIds: [selectedChannel.id, "00000000-0000-0000-0000-000000000502"],
    });

    await Promise.resolve();
    await Promise.resolve();

    setBatchEnrichmentActionState.mockClear();
    setReloadToken.mockClear();

    await element.props.onRequestSelectedEnrichment();

    expect(setBatchEnrichmentActionState).toHaveBeenNthCalledWith(2, {
      type: "error",
      message:
        "Queued 1 channel for enrichment. 1 request failed: Assigned YouTube API key is required before requesting enrichment. The table refreshes automatically while jobs run.",
    });

    const updateReloadToken = setReloadToken.mock.calls[0]?.[0] as
      | ((current: number) => number)
      | undefined;

    expect(updateReloadToken?.(3)).toBe(4);
  });

  it("creates a selected CSV export batch with deduped channel ids", async () => {
    const selectedChannel = createChannel(
      "00000000-0000-0000-0000-000000000601",
      "Export Channel",
    );
    const batchSummary = createCsvExportBatchSummary({
      id: "7ca4561f-f007-4c31-b7f6-d4025ca9f42a",
    });
    createCsvExportBatchMock.mockResolvedValueOnce(batchSummary);

    const { element, setLatestCsvExportBatch } = renderShell({
      requestState: createReadyState({
        items: [selectedChannel],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
      selectedChannelIds: [selectedChannel.id, selectedChannel.id],
    });

    setLatestCsvExportBatch.mockClear();

    await element.props.onExportSelectedChannels();

    expect(createCsvExportBatchMock).toHaveBeenCalledWith({
      type: "selected",
      channelIds: [selectedChannel.id],
    });
    expect(setLatestCsvExportBatch).toHaveBeenNthCalledWith(1, {
      requestState: "loading",
      summary: null,
      detail: null,
      error: null,
      isRefreshing: false,
    });
    expect(setLatestCsvExportBatch).toHaveBeenNthCalledWith(2, {
      requestState: "loading",
      summary: batchSummary,
      detail: null,
      error: null,
      isRefreshing: false,
    });
  });

  it("creates a selected HubSpot push batch with deduped channel ids", async () => {
    const firstChannel = createChannel(
      "00000000-0000-0000-0000-000000000701",
      "Push One",
    );
    const secondChannel = createChannel(
      "00000000-0000-0000-0000-000000000702",
      "Push Two",
    );
    const batchSummary = createHubspotPushBatchSummary({
      id: "b85ee0f6-bd02-4285-86eb-2d3d489ef48a",
      totalRowCount: 2,
    });
    createHubspotPushBatchMock.mockResolvedValueOnce(batchSummary);

    const { element, setLatestHubspotPushBatch } = renderShell({
      requestState: createReadyState({
        items: [firstChannel, secondChannel],
        total: 2,
        page: 1,
        pageSize: 20,
      }),
      selectedChannelIds: [firstChannel.id, secondChannel.id, firstChannel.id],
    });

    setLatestHubspotPushBatch.mockClear();

    await element.props.onPushSelectedChannelsToHubspot();

    expect(createHubspotPushBatchMock).toHaveBeenCalledWith({
      channelIds: [firstChannel.id, secondChannel.id],
    });
    expect(setLatestHubspotPushBatch).toHaveBeenNthCalledWith(1, {
      requestState: "loading",
      summary: null,
      detail: null,
      error: null,
      isRefreshing: false,
    });
    expect(setLatestHubspotPushBatch).toHaveBeenNthCalledWith(2, {
      requestState: "loading",
      summary: batchSummary,
      detail: null,
      error: null,
      isRefreshing: false,
    });
  });

  it("keeps the current selection intact when export creation fails", async () => {
    const selectedChannel = createChannel(
      "00000000-0000-0000-0000-000000000801",
      "Failure Channel",
    );
    createCsvExportBatchMock.mockRejectedValueOnce(new Error("Export queue down"));

    const { element, setLatestCsvExportBatch, setSelectedChannelIds } = renderShell({
      requestState: createReadyState({
        items: [selectedChannel],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
      selectedChannelIds: [selectedChannel.id],
    });

    setLatestCsvExportBatch.mockClear();
    setSelectedChannelIds.mockClear();

    await element.props.onExportSelectedChannels();

    expect(setLatestCsvExportBatch).toHaveBeenNthCalledWith(2, {
      requestState: "error",
      summary: null,
      detail: null,
      error: "Export queue down",
      isRefreshing: false,
    });
    expect(setSelectedChannelIds).not.toHaveBeenCalled();
  });

  it("polls latest export and HubSpot batches while they remain queued or running", () => {
    vi.useFakeTimers();

    try {
      const { setLatestCsvExportBatchReloadToken, setLatestHubspotPushBatchReloadToken } = renderShell({
        latestCsvExportBatch: {
          requestState: "ready",
          summary: createCsvExportBatchSummary({
            status: "running",
          }),
          detail: null,
          error: null,
          isRefreshing: false,
        },
        latestHubspotPushBatch: {
          requestState: "ready",
          summary: createHubspotPushBatchSummary({
            status: "queued",
          }),
          detail: null,
          error: null,
          isRefreshing: false,
        },
      });

      vi.advanceTimersByTime(CATALOG_BATCH_STATUS_POLL_INTERVAL_MS);

      const updateCsvReloadToken = setLatestCsvExportBatchReloadToken.mock.calls[0]?.[0] as
        | ((current: number) => number)
        | undefined;
      const updateHubspotReloadToken =
        setLatestHubspotPushBatchReloadToken.mock.calls[0]?.[0] as
          | ((current: number) => number)
          | undefined;

      expect(updateCsvReloadToken?.(0)).toBe(1);
      expect(updateHubspotReloadToken?.(4)).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });
});
