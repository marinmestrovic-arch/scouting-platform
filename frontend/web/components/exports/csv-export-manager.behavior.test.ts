import type { CsvExportBatchSummary } from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCsvExportBatchesMock, useEffectMock, useStateMock } = vi.hoisted(() => ({
  fetchCsvExportBatchesMock: vi.fn(),
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

vi.mock("../../lib/csv-export-batches-api", () => ({
  CsvExportBatchesApiError: class CsvExportBatchesApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "CsvExportBatchesApiError";
      this.status = status;
    }
  },
  fetchCsvExportBatches: fetchCsvExportBatchesMock,
  getCsvExportBatchDownloadUrl: vi.fn((batchId: string) => `/api/csv-export-batches/${batchId}/download`),
}));

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

function renderShell(options?: {
  historyState?: CsvExportManagerViewProps["historyState"];
  reloadToken?: number;
  isRefreshing?: boolean;
  runEffects?: boolean;
}) {
  const historyState =
    options?.historyState ??
    {
      status: "loading" as const,
      items: [],
      error: null,
    };
  const reloadToken = options?.reloadToken ?? 0;
  const isRefreshing = options?.isRefreshing ?? false;

  const setters = {
    setHistoryState: vi.fn(),
    setReloadToken: vi.fn(),
    setIsRefreshing: vi.fn(),
  };
  const cleanups: Array<() => void> = [];

  useStateMock.mockReset();
  useEffectMock.mockReset();
  useStateMock
    .mockReturnValueOnce([historyState, setters.setHistoryState])
    .mockReturnValueOnce([reloadToken, setters.setReloadToken])
    .mockReturnValueOnce([isRefreshing, setters.setIsRefreshing]);
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
});
