import type {
  AdminAdvancedReportRequestDetail,
  AdminAdvancedReportRequestSummary,
  AdvancedReportRequestStatus,
} from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useEffectMock,
  useStateMock,
  fetchAdminAdvancedReportRequestsMock,
  fetchAdminAdvancedReportRequestDetailMock,
  approveAdminAdvancedReportRequestMock,
  rejectAdminAdvancedReportRequestMock,
} = vi.hoisted(() => ({
  useEffectMock: vi.fn(),
  useStateMock: vi.fn(),
  fetchAdminAdvancedReportRequestsMock: vi.fn(),
  fetchAdminAdvancedReportRequestDetailMock: vi.fn(),
  approveAdminAdvancedReportRequestMock: vi.fn(),
  rejectAdminAdvancedReportRequestMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: "a",
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useEffect: useEffectMock,
    useState: useStateMock,
  };
});

vi.mock("../../lib/admin-advanced-reports-api", () => ({
  AdminAdvancedReportApiError: class AdminAdvancedReportApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "AdminAdvancedReportApiError";
      this.status = status;
    }
  },
  fetchAdminAdvancedReportRequests: fetchAdminAdvancedReportRequestsMock,
  fetchAdminAdvancedReportRequestDetail: fetchAdminAdvancedReportRequestDetailMock,
  approveAdminAdvancedReportRequest: approveAdminAdvancedReportRequestMock,
  rejectAdminAdvancedReportRequest: rejectAdminAdvancedReportRequestMock,
}));

import { AdminAdvancedReportApiError } from "../../lib/admin-advanced-reports-api";
import {
  ADMIN_ADVANCED_REPORT_POLL_INTERVAL_MS,
  AdminAdvancedReportQueue,
  AdminAdvancedReportQueueView,
} from "./admin-advanced-report-queue";

type QueueViewProps = Parameters<typeof AdminAdvancedReportQueueView>[0];
type QueueShellElement = ReactElement<QueueViewProps>;

function buildSummary(
  overrides?: Partial<AdminAdvancedReportRequestSummary>,
): AdminAdvancedReportRequestSummary {
  return {
    id: "c99a95aa-363f-4a7e-bd38-680251d42ff0",
    channel: {
      id: "75aa14d8-0311-4de6-802d-afeb6e3a49b7",
      youtubeChannelId: "UC-QUEUE-1",
      title: "Queue Channel",
    },
    requestedBy: {
      id: "62a7c45d-a1b7-4bd2-9b0f-36570a27ea28",
      email: "manager@example.com",
      name: "Manager",
    },
    reviewedBy: null,
    status: "pending_approval",
    decisionNote: null,
    lastError: null,
    createdAt: "2026-03-11T09:00:00.000Z",
    updatedAt: "2026-03-11T09:05:00.000Z",
    reviewedAt: null,
    startedAt: null,
    completedAt: null,
    lastCompletedReport: {
      requestId: "d4ddbb49-fbd3-4257-baa4-7b3a6a463693",
      completedAt: "2026-02-28T09:00:00.000Z",
      ageDays: 12,
      withinFreshWindow: true,
    },
    ...overrides,
  };
}

function buildDetail(
  overrides?: Partial<AdminAdvancedReportRequestDetail>,
): AdminAdvancedReportRequestDetail {
  return {
    ...buildSummary(),
    insights: {
      audienceCountries: [],
      audienceGenderAge: [],
      audienceInterests: [],
      estimatedPrice: null,
      brandMentions: [],
    },
    rawPayload: {
      report: {
        state: "finished",
      },
    },
    ...overrides,
  };
}

function createShellState(options?: {
  statusFilter?: AdvancedReportRequestStatus;
  listState?: QueueViewProps["listState"];
  detailState?: QueueViewProps["detailState"];
  selectedRequestId?: string | null;
  decisionNoteDraft?: string;
  actionState?: QueueViewProps["actionState"];
  listReloadToken?: number;
  detailReloadToken?: number;
  isRefreshingList?: boolean;
  isRefreshingDetail?: boolean;
}) {
  return {
    statusFilter: options?.statusFilter ?? "pending_approval",
    listState:
      options?.listState ??
      {
        status: "loading" as const,
        items: [],
        error: null,
      },
    detailState:
      options?.detailState ??
      {
        status: "idle" as const,
        data: null,
        error: null,
      },
    selectedRequestId: options?.selectedRequestId ?? null,
    decisionNoteDraft: options?.decisionNoteDraft ?? "",
    actionState:
      options?.actionState ??
      {
        type: "idle" as const,
        action: null,
        message: "",
      },
    listReloadToken: options?.listReloadToken ?? 0,
    detailReloadToken: options?.detailReloadToken ?? 0,
    isRefreshingList: options?.isRefreshingList ?? false,
    isRefreshingDetail: options?.isRefreshingDetail ?? false,
  };
}

function renderShell(options?: Parameters<typeof createShellState>[0] & { runEffects?: boolean }) {
  const state = createShellState(options);
  const setters = {
    setStatusFilter: vi.fn(),
    setListState: vi.fn(),
    setDetailState: vi.fn(),
    setSelectedRequestId: vi.fn(),
    setDecisionNoteDraft: vi.fn(),
    setActionState: vi.fn(),
    setListReloadToken: vi.fn(),
    setDetailReloadToken: vi.fn(),
    setIsRefreshingList: vi.fn(),
    setIsRefreshingDetail: vi.fn(),
  };
  const cleanups: Array<() => void> = [];

  useStateMock.mockReset();
  useEffectMock.mockReset();
  useStateMock
    .mockReturnValueOnce([state.statusFilter, setters.setStatusFilter])
    .mockReturnValueOnce([state.listState, setters.setListState])
    .mockReturnValueOnce([state.detailState, setters.setDetailState])
    .mockReturnValueOnce([state.selectedRequestId, setters.setSelectedRequestId])
    .mockReturnValueOnce([state.decisionNoteDraft, setters.setDecisionNoteDraft])
    .mockReturnValueOnce([state.actionState, setters.setActionState])
    .mockReturnValueOnce([state.listReloadToken, setters.setListReloadToken])
    .mockReturnValueOnce([state.detailReloadToken, setters.setDetailReloadToken])
    .mockReturnValueOnce([state.isRefreshingList, setters.setIsRefreshingList])
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

  const element = AdminAdvancedReportQueue() as QueueShellElement;

  return {
    cleanups,
    element,
    setters,
  };
}

describe("admin advanced report queue behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAdminAdvancedReportRequestsMock.mockResolvedValue([buildSummary()]);
    fetchAdminAdvancedReportRequestDetailMock.mockResolvedValue(buildDetail());
    approveAdminAdvancedReportRequestMock.mockResolvedValue(
      buildDetail({
        status: "queued",
        decisionNote: "Approved.",
      }),
    );
    rejectAdminAdvancedReportRequestMock.mockResolvedValue(
      buildDetail({
        status: "rejected",
        decisionNote: "Not approved.",
      }),
    );
  });

  it("loads the queue on mount and auto-selects the first request", async () => {
    const { setters } = renderShell();

    expect(fetchAdminAdvancedReportRequestsMock).toHaveBeenCalledWith(
      { status: "pending_approval" },
      expect.any(AbortSignal),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(setters.setListState).toHaveBeenCalledWith({
      status: "ready",
      items: [buildSummary()],
      error: null,
    });
    expect(setters.setSelectedRequestId).toHaveBeenCalledWith(buildSummary().id);
  });

  it("loads request detail for the selected row and syncs the decision note", async () => {
    const selectedRequestId = buildSummary().id;

    renderShell({
      listState: {
        status: "ready",
        items: [buildSummary()],
        error: null,
      },
      detailState: {
        status: "loading",
        data: null,
        error: null,
      },
      selectedRequestId,
    });

    expect(fetchAdminAdvancedReportRequestDetailMock).toHaveBeenCalledWith(
      selectedRequestId,
      expect.any(AbortSignal),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(fetchAdminAdvancedReportRequestDetailMock).toHaveBeenCalledTimes(1);
  });

  it("polls the list while pending approval view is active", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
      void handler();
      return 321 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);
    const { cleanups, setters } = renderShell({
      listState: {
        status: "ready",
        items: [buildSummary()],
        error: null,
      },
    });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), ADMIN_ADVANCED_REPORT_POLL_INTERVAL_MS);
    expect(setters.setListReloadToken).toHaveBeenCalledWith(expect.any(Function));

    const reloadTokenUpdater = setters.setListReloadToken.mock.calls[0]?.[0] as ((value: number) => number) | undefined;

    expect(reloadTokenUpdater?.(5)).toBe(6);

    cleanups.forEach((cleanup) => cleanup());
    expect(clearTimeoutSpy).toHaveBeenCalledWith(321);
  });

  it("resets queue state when the filter changes", () => {
    const { element, setters } = renderShell({
      runEffects: false,
      listState: {
        status: "ready",
        items: [buildSummary()],
        error: null,
      },
      detailState: {
        status: "ready",
        data: buildDetail(),
        error: null,
      },
      selectedRequestId: buildSummary().id,
      decisionNoteDraft: "Keep this note",
      isRefreshingList: true,
      isRefreshingDetail: true,
    });

    element.props.onStatusFilterChange("completed");

    expect(setters.setStatusFilter).toHaveBeenCalledWith("completed");
    expect(setters.setListState).toHaveBeenCalledWith({
      status: "loading",
      items: [],
      error: null,
    });
    expect(setters.setDetailState).toHaveBeenCalledWith({
      status: "idle",
      data: null,
      error: null,
    });
    expect(setters.setSelectedRequestId).toHaveBeenCalledWith(null);
    expect(setters.setDecisionNoteDraft).toHaveBeenCalledWith("");
    expect(setters.setActionState).toHaveBeenCalledWith({
      type: "idle",
      action: null,
      message: "",
    });
    expect(setters.setIsRefreshingList).toHaveBeenCalledWith(false);
    expect(setters.setIsRefreshingDetail).toHaveBeenCalledWith(false);
  });

  it("approves a pending request with a trimmed note and refreshes the queue", async () => {
    const { element, setters } = renderShell({
      runEffects: false,
      detailState: {
        status: "ready",
        data: buildDetail(),
        error: null,
      },
      selectedRequestId: buildSummary().id,
      decisionNoteDraft: "  Approved.  ",
    });

    await element.props.onApprove();

    expect(approveAdminAdvancedReportRequestMock).toHaveBeenCalledWith(buildSummary().id, {
      decisionNote: "Approved.",
    });
    expect(setters.setActionState).toHaveBeenNthCalledWith(1, {
      type: "submitting",
      action: "approve",
      message: "",
    });
    expect(setters.setDetailState).toHaveBeenCalledWith({
      status: "ready",
      data: buildDetail({
        status: "queued",
        decisionNote: "Approved.",
      }),
      error: null,
    });
    expect(setters.setDecisionNoteDraft).toHaveBeenCalledWith("Approved.");
    expect(setters.setActionState).toHaveBeenLastCalledWith({
      type: "success",
      action: null,
      message: "Approval recorded. The request has moved forward for worker processing.",
    });
    expect(setters.setListReloadToken).toHaveBeenCalledWith(expect.any(Function));
  });

  it("refreshes list and detail when an approval conflict occurs", async () => {
    approveAdminAdvancedReportRequestMock.mockRejectedValueOnce(
      new AdminAdvancedReportApiError("Only pending approval requests can be approved", 409),
    );
    const { element, setters } = renderShell({
      runEffects: false,
      detailState: {
        status: "ready",
        data: buildDetail(),
        error: null,
      },
      selectedRequestId: buildSummary().id,
      decisionNoteDraft: "Approved.",
    });

    await element.props.onApprove();

    expect(setters.setActionState).toHaveBeenLastCalledWith({
      type: "error",
      action: "approve",
      message: "Only pending approval requests can be approved",
    });
    expect(setters.setListReloadToken).toHaveBeenCalledWith(expect.any(Function));
    expect(setters.setDetailReloadToken).toHaveBeenCalledWith(expect.any(Function));
  });

  it("falls forward to the next available request when the current selection drops out", async () => {
    const nextRequest = buildSummary({
      id: "3a6f37c9-84d2-4dca-bf4f-b26ecce7ec6f",
      channel: {
        id: "7ad5b75b-3f7f-4f3d-aed7-b358eb69dd2f",
        youtubeChannelId: "UC-QUEUE-2",
        title: "Next Queue Channel",
      },
    });
    fetchAdminAdvancedReportRequestsMock.mockResolvedValueOnce([nextRequest]);

    const { setters } = renderShell({
      listState: {
        status: "ready",
        items: [buildSummary()],
        error: null,
      },
      selectedRequestId: buildSummary().id,
      actionState: {
        type: "success",
        action: null,
        message: "Approval recorded.",
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(setters.setSelectedRequestId).toHaveBeenCalledWith(nextRequest.id);
    expect(setters.setActionState).toHaveBeenCalledWith({
      type: "idle",
      action: null,
      message: "",
    });
  });
});
