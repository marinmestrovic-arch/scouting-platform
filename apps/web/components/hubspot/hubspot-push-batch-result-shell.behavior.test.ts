import type {
  HubspotImportBatchDetail,
  HubspotPushBatchDetail,
} from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchHubspotImportBatchDetailMock,
  fetchHubspotPushBatchDetailMock,
  useEffectMock,
  useStateMock,
} = vi.hoisted(() => ({
  fetchHubspotImportBatchDetailMock: vi.fn(),
  fetchHubspotPushBatchDetailMock: vi.fn(),
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
}));

import {
  HubspotImportBatchesApiError,
} from "../../lib/hubspot-import-batches-api";
import {
  HubspotPushBatchesApiError,
} from "../../lib/hubspot-push-batches-api";
import {
  HUBSPOT_PUSH_BATCH_RESULT_POLL_INTERVAL_MS,
  HubspotPushBatchResultShell,
} from "./hubspot-push-batch-result-shell";

type HubspotPushBatchResultShellElement = ReactElement<{
  batchId: string;
  isRefreshing: boolean;
  onRetry: () => void;
  requestState: {
    requestState: "loading" | "error" | "notFound" | "ready";
    data:
      | { kind: "import"; batch: HubspotImportBatchDetail }
      | { kind: "legacy"; batch: HubspotPushBatchDetail }
      | null;
    error: string | null;
  };
}>;

function buildImportDetail(
  overrides?: Partial<HubspotImportBatchDetail>,
): HubspotImportBatchDetail {
  return {
    id: "fdd240f2-ef31-43fe-b1d2-a584951654a8",
    run: {
      id: "57c8b6a1-85cf-4f51-a510-43fd61026f29",
      name: "Spring gaming outreach",
    },
    fileName: "spring-gaming-outreach-hubspot.csv",
    schemaVersion: "week7-hubspot-import-v1",
    status: "completed",
    totalRowCount: 2,
    preparedRowCount: 1,
    failedRowCount: 1,
    lastError: null,
    requestedBy: {
      id: "8c1136b4-1c95-4e8c-aefe-0e58df0a39d5",
      email: "manager@example.com",
      name: "Manager",
    },
    createdAt: "2026-03-13T09:00:00.000Z",
    updatedAt: "2026-03-13T09:02:00.000Z",
    startedAt: "2026-03-13T09:01:00.000Z",
    completedAt: "2026-03-13T09:02:00.000Z",
    rows: [],
    ...overrides,
  };
}

function buildLegacyDetail(
  overrides?: Partial<HubspotPushBatchDetail>,
): HubspotPushBatchDetail {
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
    scope: {
      channelIds: [
        "14e40450-71c2-4e0e-a160-b787d21843fd",
        "f3d0fbec-f8a0-40ad-8e19-2370c6b99083",
      ],
    },
    rows: [],
    ...overrides,
  };
}

function renderShell(options?: {
  requestState?: {
    requestState: "loading" | "error" | "notFound" | "ready";
    data:
      | { kind: "import"; batch: HubspotImportBatchDetail }
      | { kind: "legacy"; batch: HubspotPushBatchDetail }
      | null;
    error: string | null;
  };
  reloadToken?: number;
  isRefreshing?: boolean;
}) {
  const setRequestState = vi.fn();
  const setReloadToken = vi.fn();
  const setIsRefreshing = vi.fn();
  const cleanups: Array<() => void> = [];

  useStateMock.mockReset();
  useEffectMock.mockReset();
  useStateMock
    .mockReturnValueOnce([
      options?.requestState ?? {
        requestState: "loading" as const,
        data: null,
        error: null,
      },
      setRequestState,
    ])
    .mockReturnValueOnce([options?.reloadToken ?? 0, setReloadToken])
    .mockReturnValueOnce([options?.isRefreshing ?? false, setIsRefreshing]);
  useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
    const maybeCleanup = effect();

    if (typeof maybeCleanup === "function") {
      cleanups.push(maybeCleanup);
    }
  });

  const element = HubspotPushBatchResultShell({
    batchId: "fdd240f2-ef31-43fe-b1d2-a584951654a8",
  }) as HubspotPushBatchResultShellElement;

  return {
    cleanups,
    element,
    setIsRefreshing,
    setReloadToken,
    setRequestState,
  };
}

describe("hubspot push batch result shell behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads import batch detail on mount and aborts the request on cleanup", async () => {
    const detail = buildImportDetail();
    fetchHubspotImportBatchDetailMock.mockResolvedValueOnce(detail);

    const { cleanups, setRequestState } = renderShell();

    const loadingUpdater = setRequestState.mock.calls[0]?.[0] as
      | ((
          current: {
            requestState: "loading" | "error" | "notFound" | "ready";
            data:
              | { kind: "import"; batch: HubspotImportBatchDetail }
              | { kind: "legacy"; batch: HubspotPushBatchDetail }
              | null;
            error: string | null;
          },
        ) => {
          requestState: "loading" | "error" | "notFound" | "ready";
          data:
            | { kind: "import"; batch: HubspotImportBatchDetail }
            | { kind: "legacy"; batch: HubspotPushBatchDetail }
            | null;
          error: string | null;
        })
      | undefined;

    expect(
      loadingUpdater?.({
        requestState: "loading",
        data: null,
        error: null,
      }),
    ).toEqual({
      requestState: "loading",
      data: null,
      error: null,
    });
    expect(fetchHubspotImportBatchDetailMock).toHaveBeenCalledWith(
      "fdd240f2-ef31-43fe-b1d2-a584951654a8",
      expect.any(AbortSignal),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenNthCalledWith(2, {
      requestState: "ready",
      data: {
        kind: "import",
        batch: detail,
      },
      error: null,
    });

    const signal = fetchHubspotImportBatchDetailMock.mock.calls[0]?.[1] as
      | AbortSignal
      | undefined;

    cleanups.forEach((cleanup) => {
      cleanup();
    });

    expect(signal?.aborted).toBe(true);
  });

  it("falls back to legacy detail when the import batch lookup returns 404", async () => {
    const detail = buildLegacyDetail();
    fetchHubspotImportBatchDetailMock.mockRejectedValueOnce(
      new HubspotImportBatchesApiError("HubSpot import batch not found.", 404),
    );
    fetchHubspotPushBatchDetailMock.mockResolvedValueOnce(detail);

    const { setRequestState } = renderShell();

    await Promise.resolve();
    await Promise.resolve();

    expect(fetchHubspotPushBatchDetailMock).toHaveBeenCalledWith(
      "fdd240f2-ef31-43fe-b1d2-a584951654a8",
      expect.any(AbortSignal),
    );
    expect(setRequestState).toHaveBeenLastCalledWith({
      requestState: "ready",
      data: {
        kind: "legacy",
        batch: detail,
      },
      error: null,
    });
  });

  it("marks the screen as not found when neither import nor legacy batch exists", async () => {
    fetchHubspotImportBatchDetailMock.mockRejectedValueOnce(
      new HubspotImportBatchesApiError("HubSpot import batch not found.", 404),
    );
    fetchHubspotPushBatchDetailMock.mockRejectedValueOnce(
      new HubspotPushBatchesApiError("HubSpot push batch not found.", 404),
    );

    const { setRequestState } = renderShell();

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenLastCalledWith({
      requestState: "notFound",
      data: null,
      error: null,
    });
  });

  it("schedules polling while queued or running work remains", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    try {
      const detail = buildImportDetail({ status: "running" });
      fetchHubspotImportBatchDetailMock.mockResolvedValue(detail);

      const { setIsRefreshing } = renderShell({
        requestState: {
          requestState: "ready",
          data: {
            kind: "import",
            batch: detail,
          },
          error: null,
        },
        isRefreshing: false,
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        HUBSPOT_PUSH_BATCH_RESULT_POLL_INTERVAL_MS,
      );

      vi.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();

      expect(setIsRefreshing).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the current detail visible when a refresh fails", async () => {
    const detail = buildImportDetail();
    fetchHubspotImportBatchDetailMock.mockRejectedValueOnce(new Error("Detail down"));

    const { setRequestState } = renderShell({
      requestState: {
        requestState: "ready",
        data: {
          kind: "import",
          batch: detail,
        },
        error: null,
      },
      isRefreshing: false,
    });

    await Promise.resolve();
    await Promise.resolve();

    const updater = setRequestState.mock.calls
      .filter((call) => typeof call[0] === "function")
      .at(-1)?.[0] as
      | ((
          current: {
            requestState: "loading" | "error" | "notFound" | "ready";
            data:
              | { kind: "import"; batch: HubspotImportBatchDetail }
              | { kind: "legacy"; batch: HubspotPushBatchDetail }
              | null;
            error: string | null;
          },
        ) => {
          requestState: "loading" | "error" | "notFound" | "ready";
          data:
            | { kind: "import"; batch: HubspotImportBatchDetail }
            | { kind: "legacy"; batch: HubspotPushBatchDetail }
            | null;
          error: string | null;
        })
      | undefined;

    expect(
      updater?.({
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
});
