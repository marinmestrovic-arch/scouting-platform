import type { ListChannelsResponse, SegmentResponse } from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createSavedSegmentMock,
  deleteSavedSegmentMock,
  fetchChannelsMock,
  fetchSavedSegmentsMock,
  replaceMock,
  useEffectMock,
  usePathnameMock,
  useRouterMock,
  useSearchParamsMock,
  useStateMock,
} = vi.hoisted(() => ({
  createSavedSegmentMock: vi.fn(),
  deleteSavedSegmentMock: vi.fn(),
  fetchChannelsMock: vi.fn(),
  fetchSavedSegmentsMock: vi.fn(),
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
}));

vi.mock("../../lib/segments-api", () => ({
  createSavedSegment: createSavedSegmentMock,
  deleteSavedSegment: deleteSavedSegmentMock,
  fetchSavedSegments: fetchSavedSegmentsMock,
}));

import {
  CATALOG_ENRICHMENT_POLL_INTERVAL_MS,
  CatalogTableShell,
} from "./catalog-table-shell";

type CatalogShellElement = ReactElement<{
  onApplyFilters: () => void;
  onClearSelection: () => void;
  onCreateSegment: () => Promise<void> | void;
  onDeleteSegment: (segment: SegmentResponse) => Promise<void> | void;
  onLoadSegment: (segment: SegmentResponse) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
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
    .mockReturnValueOnce([options?.selectedChannelIds ?? [], setSelectedChannelIds]);

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
    fetchSavedSegmentsMock.mockResolvedValue([createSavedSegment()]);
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

    expect(setDraftFilters).toHaveBeenCalledWith({
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
});
