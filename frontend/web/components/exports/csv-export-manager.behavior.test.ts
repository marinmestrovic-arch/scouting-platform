import type { CsvExportBatchSummary } from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createCsvExportBatchMock,
  fetchCsvExportBatchesMock,
  replaceMock,
  useEffectMock,
  usePathnameMock,
  useRouterMock,
  useSearchParamsMock,
  useStateMock,
} = vi.hoisted(() => ({
  createCsvExportBatchMock: vi.fn(),
  fetchCsvExportBatchesMock: vi.fn(),
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

vi.mock("../../lib/csv-export-batches-api", () => ({
  CsvExportBatchesApiError: class CsvExportBatchesApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "CsvExportBatchesApiError";
      this.status = status;
    }
  },
  createCsvExportBatch: createCsvExportBatchMock,
  fetchCsvExportBatches: fetchCsvExportBatchesMock,
  getCsvExportBatchDownloadUrl: vi.fn((batchId: string) => `/api/csv-export-batches/${batchId}/download`),
}));

import { CsvExportBatchesApiError } from "../../lib/csv-export-batches-api";
import {
  CSV_EXPORT_HISTORY_POLL_INTERVAL_MS,
  CsvExportManager,
  CsvExportManagerView,
} from "./csv-export-manager";

type CsvExportManagerViewProps = Parameters<typeof CsvExportManagerView>[0];
type CsvExportManagerElement = ReactElement<CsvExportManagerViewProps>;

function buildSummary(overrides?: Partial<CsvExportBatchSummary>): CsvExportBatchSummary {
  return {
    id: "99d39ccb-3cf5-4f09-a647-a0e1387d31cb",
    scopeType: "filtered",
    fileName: "space-creators.csv",
    schemaVersion: "v1",
    status: "queued",
    rowCount: 12,
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

function buildFilters(
  overrides?: Partial<CsvExportManagerViewProps["filters"]>,
): CsvExportManagerViewProps["filters"] {
  return {
    query: "",
    countryRegion: [],
    influencerVertical: [],
    influencerType: [],
    youtubeVideoMedianViewsMin: "",
    youtubeVideoMedianViewsMax: "",
    youtubeShortsMedianViewsMin: "",
    youtubeShortsMedianViewsMax: "",
    youtubeFollowersMin: "",
    youtubeFollowersMax: "",
    ...overrides,
  };
}

function createShellState(options?: {
  filters?: CsvExportManagerViewProps["filters"];
  historyState?: CsvExportManagerViewProps["historyState"];
  createState?: CsvExportManagerViewProps["createState"];
  reloadToken?: number;
  isRefreshing?: boolean;
}) {
  return {
    filters:
      options?.filters ??
      buildFilters(),
    historyState:
      options?.historyState ??
      {
        status: "loading" as const,
        items: [],
        error: null,
      },
    createState:
      options?.createState ??
      {
        type: "idle" as const,
        message: "",
      },
    reloadToken: options?.reloadToken ?? 0,
    isRefreshing: options?.isRefreshing ?? false,
  };
}

function renderShell(options?: Parameters<typeof createShellState>[0] & { runEffects?: boolean; searchParams?: URLSearchParams }) {
  const state = createShellState(options);
  const setters = {
    setFilters: vi.fn(),
    setHistoryState: vi.fn(),
    setCreateState: vi.fn(),
    setReloadToken: vi.fn(),
    setIsRefreshing: vi.fn(),
  };
  const cleanups: Array<() => void> = [];

  useStateMock.mockReset();
  useEffectMock.mockReset();
  replaceMock.mockReset();
  usePathnameMock.mockReturnValue("/exports");
  useRouterMock.mockReturnValue({
    replace: replaceMock,
  });
  useSearchParamsMock.mockReturnValue(
    options?.searchParams ??
      createSearchParams({
        query: "space",
        countryRegion: ["Croatia"],
      }),
  );
  useStateMock
    .mockReturnValueOnce([state.filters, setters.setFilters])
    .mockReturnValueOnce([state.historyState, setters.setHistoryState])
    .mockReturnValueOnce([state.createState, setters.setCreateState])
    .mockReturnValueOnce([state.reloadToken, setters.setReloadToken])
    .mockReturnValueOnce([state.isRefreshing, setters.setIsRefreshing]);
  useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
    if (options?.runEffects === false) {
      return;
    }

    const cleanup = effect();

    if (typeof cleanup === "function") {
      cleanups.push(cleanup);
    }
  });

  const element = CsvExportManager() as CsvExportManagerElement;

  return {
    cleanups,
    element,
    setters,
  };
}

describe("csv export manager behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCsvExportBatchesMock.mockResolvedValue([buildSummary()]);
    createCsvExportBatchMock.mockResolvedValue(
      buildSummary({
        id: "2f1d3721-6ed4-4ae5-a711-3ad7f71b4195",
        status: "queued",
      }),
    );
  });

  it("loads export history on mount", async () => {
    const { setters } = renderShell();

    expect(fetchCsvExportBatchesMock).toHaveBeenCalledWith(expect.any(AbortSignal));

    await Promise.resolve();
    await Promise.resolve();

    expect(setters.setHistoryState).toHaveBeenCalledWith({
      status: "ready",
      items: [buildSummary()],
      error: null,
    });
  });

  it("requires at least one filter before creating a filtered export", async () => {
    const { element, setters } = renderShell({
      runEffects: false,
      filters: buildFilters(),
    });

    await element.props.onCreateFilteredExport();

    expect(createCsvExportBatchMock).not.toHaveBeenCalled();
    expect(setters.setCreateState).toHaveBeenCalledWith({
      type: "error",
      message: "Choose at least one filter before creating a filtered export.",
    });
  });

  it("creates a filtered export batch with the current URL-backed filters", async () => {
    const createdBatch = buildSummary({
      id: "2f1d3721-6ed4-4ae5-a711-3ad7f71b4195",
      status: "queued",
    });
    createCsvExportBatchMock.mockResolvedValueOnce(createdBatch);
    const { element, setters } = renderShell({
      runEffects: false,
      filters: buildFilters({
        query: "space",
        countryRegion: ["Croatia"],
        influencerVertical: ["Gaming"],
      }),
      historyState: {
        status: "ready",
        items: [buildSummary()],
        error: null,
      },
    });

    await element.props.onCreateFilteredExport();

    expect(createCsvExportBatchMock).toHaveBeenCalledWith({
      type: "filtered",
      filters: {
        query: "space",
        countryRegion: ["Croatia"],
        influencerVertical: ["Gaming"],
      },
    });
    expect(setters.setCreateState).toHaveBeenNthCalledWith(1, {
      type: "submitting",
      message: "",
    });
    expect(setters.setCreateState).toHaveBeenNthCalledWith(2, {
      type: "success",
      message: "Filtered CSV export queued. History refreshes automatically while processing continues.",
    });
    expect(setters.setHistoryState).toHaveBeenCalledWith(expect.any(Function));
    expect(setters.setReloadToken).toHaveBeenCalledWith(expect.any(Function));

    const historyUpdater = setters.setHistoryState.mock.calls[0]?.[0] as
      | ((value: CsvExportManagerViewProps["historyState"]) => CsvExportManagerViewProps["historyState"])
      | undefined;
    const reloadUpdater = setters.setReloadToken.mock.calls[0]?.[0] as
      | ((value: number) => number)
      | undefined;

    expect(
      historyUpdater?.({
        status: "ready",
        items: [buildSummary()],
        error: null,
      }),
    ).toEqual({
      status: "ready",
      items: [createdBatch, buildSummary()],
      error: null,
    });
    expect(reloadUpdater?.(0)).toBe(1);
  });

  it("polls export history while queued or running batches remain", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
      void handler();
      return 321 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);
    const { cleanups, setters } = renderShell({
      historyState: {
        status: "ready",
        items: [buildSummary({ status: "running" })],
        error: null,
      },
      isRefreshing: false,
    });

    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      CSV_EXPORT_HISTORY_POLL_INTERVAL_MS,
    );
    expect(setters.setReloadToken).toHaveBeenCalledWith(expect.any(Function));

    cleanups.forEach((cleanup) => {
      cleanup();
    });

    expect(clearTimeoutSpy).toHaveBeenCalledWith(321);
  });

  it("supports manual history refresh and retry flows", () => {
    const manual = renderShell({
      runEffects: false,
      historyState: {
        status: "ready",
        items: [buildSummary({ status: "completed" })],
        error: null,
      },
    });

    manual.element.props.onReloadHistory();

    const manualReloadUpdater = manual.setters.setReloadToken.mock.calls[0]?.[0] as
      | ((value: number) => number)
      | undefined;

    expect(manualReloadUpdater?.(4)).toBe(5);

    const retry = renderShell({
      runEffects: false,
      historyState: {
        status: "error",
        items: [],
        error: "Unable to load CSV export history. Please try again.",
      },
    });

    retry.element.props.onRetryHistory();

    expect(retry.setters.setHistoryState).toHaveBeenCalledWith({
      status: "loading",
      items: [],
      error: null,
    });

    const retryReloadUpdater = retry.setters.setReloadToken.mock.calls[0]?.[0] as
      | ((value: number) => number)
      | undefined;

    expect(retryReloadUpdater?.(1)).toBe(2);
  });

  it("updates the export URL when filters change and resets filter state", () => {
    const { element, setters } = renderShell({
      runEffects: false,
      filters: buildFilters({
        query: "space",
        countryRegion: ["Croatia"],
      }),
    });

    element.props.onQueryChange("mars");
    element.props.onResetFilters();

    expect(setters.setFilters).toHaveBeenNthCalledWith(1, {
      query: "mars",
      countryRegion: ["Croatia"],
      influencerVertical: [],
      influencerType: [],
      youtubeVideoMedianViewsMin: "",
      youtubeVideoMedianViewsMax: "",
      youtubeShortsMedianViewsMin: "",
      youtubeShortsMedianViewsMax: "",
      youtubeFollowersMin: "",
      youtubeFollowersMax: "",
    });
    expect(replaceMock).toHaveBeenNthCalledWith(1, "/exports?query=mars&countryRegion=Croatia");
    expect(setters.setFilters).toHaveBeenNthCalledWith(2, buildFilters());
    expect(replaceMock).toHaveBeenNthCalledWith(2, "/exports");
  });

  it("surfaces session-specific create failures", async () => {
    createCsvExportBatchMock.mockRejectedValueOnce(
      new CsvExportBatchesApiError("Forbidden", 403),
    );
    const { element, setters } = renderShell({
      runEffects: false,
      filters: buildFilters({
        query: "space",
      }),
    });

    await element.props.onCreateFilteredExport();

    expect(setters.setCreateState).toHaveBeenLastCalledWith({
      type: "error",
      message: "Your session does not allow CSV export creation anymore. Sign in again and retry.",
    });
  });
});
