"use client";

import type {
  AdminAdvancedReportRequestDetail,
  AdminAdvancedReportRequestSummary,
  AdvancedReportRequestStatus,
} from "@scouting-platform/contracts";
import Link from "next/link";
import { useEffect, useState, type ReactElement } from "react";

import {
  AdminAdvancedReportApiError,
  approveAdminAdvancedReportRequest,
  fetchAdminAdvancedReportRequestDetail,
  fetchAdminAdvancedReportRequests,
  rejectAdminAdvancedReportRequest,
} from "../../lib/admin-advanced-reports-api";

type AdminAdvancedReportListState = {
  status: "loading" | "error" | "ready";
  items: AdminAdvancedReportRequestSummary[];
  error: string | null;
};

type AdminAdvancedReportDetailState = {
  status: "idle" | "loading" | "error" | "ready";
  data: AdminAdvancedReportRequestDetail | null;
  error: string | null;
};

type AdminAdvancedReportActionState = {
  type: "idle" | "submitting" | "success" | "error";
  action: "approve" | "reject" | null;
  message: string;
};

type AdminAdvancedReportQueueViewProps = Readonly<{
  statusFilter: AdvancedReportRequestStatus;
  listState: AdminAdvancedReportListState;
  detailState: AdminAdvancedReportDetailState;
  selectedRequestId: string | null;
  decisionNoteDraft: string;
  actionState: AdminAdvancedReportActionState;
  isRefreshingList: boolean;
  isRefreshingDetail: boolean;
  onStatusFilterChange: (value: AdvancedReportRequestStatus) => void;
  onReload: () => void;
  onRetryList: () => void;
  onRetryDetail: () => void;
  onSelectRequest: (requestId: string) => void;
  onDecisionNoteChange: (value: string) => void;
  onApprove: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
}>;

const ACTIVE_POLLING_STATUSES = new Set<AdvancedReportRequestStatus>([
  "approved",
  "queued",
  "running",
]);

const STATUS_OPTIONS: ReadonlyArray<{
  value: AdvancedReportRequestStatus;
  label: string;
}> = [
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
] as const;

const INITIAL_LIST_STATE: AdminAdvancedReportListState = {
  status: "loading",
  items: [],
  error: null,
};

const INITIAL_DETAIL_STATE: AdminAdvancedReportDetailState = {
  status: "idle",
  data: null,
  error: null,
};

const IDLE_ACTION_STATE: AdminAdvancedReportActionState = {
  type: "idle",
  action: null,
  message: "",
};

export const ADMIN_ADVANCED_REPORT_POLL_INTERVAL_MS = 3000;

function normalizeErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not available";
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);

  if (!match) {
    return value;
  }

  return `${match[1]} ${match[2]} UTC`;
}

function toTitleCase(value: string): string {
  return value
    .split("_")
    .map((segment) => {
      if (!segment) {
        return segment;
      }

      return `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`;
    })
    .join(" ");
}

export function getAdminAdvancedReportStatusLabel(status: AdvancedReportRequestStatus): string {
  return toTitleCase(status);
}

export function getAdminAdvancedReportFreshnessCopy(
  lastCompletedReport: AdminAdvancedReportRequestSummary["lastCompletedReport"],
): string {
  if (!lastCompletedReport) {
    return "No completed report on record.";
  }

  if (lastCompletedReport.withinFreshWindow) {
    return `Last completed report is fresh (${lastCompletedReport.ageDays} days old).`;
  }

  return `Last completed report is outside the 120-day review window (${lastCompletedReport.ageDays} days old).`;
}

function getAdminAdvancedReportListSnippet(
  request: Pick<AdminAdvancedReportRequestSummary, "decisionNote" | "lastError" | "status">,
): string {
  if (request.lastError) {
    return `Last error: ${request.lastError}`;
  }

  if (request.decisionNote) {
    return `Decision note: ${request.decisionNote}`;
  }

  if (request.status === "pending_approval") {
    return "Awaiting admin review.";
  }

  if (request.status === "approved") {
    return "Approved and waiting for worker queueing.";
  }

  if (request.status === "queued" || request.status === "running") {
    return "Worker execution is in progress.";
  }

  return "No additional review notes recorded.";
}

function getAdminAdvancedReportEmptyStateCopy(statusFilter: AdvancedReportRequestStatus): string {
  if (statusFilter === "pending_approval") {
    return "No pending approval requests right now.";
  }

  return `No ${getAdminAdvancedReportStatusLabel(statusFilter).toLowerCase()} requests found.`;
}

export function shouldPollAdminAdvancedReportList(input: {
  statusFilter: AdvancedReportRequestStatus;
  items: readonly Pick<AdminAdvancedReportRequestSummary, "status">[];
}): boolean {
  if (input.statusFilter === "pending_approval") {
    return true;
  }

  return input.items.some((item) => ACTIVE_POLLING_STATUSES.has(item.status));
}

export function shouldPollAdminAdvancedReportDetail(
  request: Pick<AdminAdvancedReportRequestDetail, "status"> | null,
): boolean {
  if (!request) {
    return false;
  }

  return ACTIVE_POLLING_STATUSES.has(request.status);
}

function getListErrorMessage(error: unknown): string {
  if (error instanceof AdminAdvancedReportApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow advanced report review anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to load advanced report requests. Please try again.");
}

function getDetailErrorMessage(error: unknown): string {
  if (error instanceof AdminAdvancedReportApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow request detail review anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to load advanced report request details. Please try again.");
}

function getDecisionErrorMessage(error: unknown): string {
  if (error instanceof AdminAdvancedReportApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow approval decisions anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to record the approval decision. Please try again.");
}

function getDecisionSuccessMessage(action: "approve" | "reject"): string {
  if (action === "approve") {
    return "Approval recorded. The request has moved forward for worker processing.";
  }

  return "Rejection recorded. The request has been removed from the pending queue.";
}

function resolveNextSelectedRequestId(
  currentRequestId: string | null,
  items: readonly AdminAdvancedReportRequestSummary[],
): string | null {
  if (items.length === 0) {
    return null;
  }

  if (currentRequestId && items.some((item) => item.id === currentRequestId)) {
    return currentRequestId;
  }

  return items[0]?.id ?? null;
}

function serializeRawPayload(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "Raw payload could not be serialized.";
  }
}

function renderDetailState(
  props: AdminAdvancedReportQueueViewProps,
): ReactElement {
  const { detailState, decisionNoteDraft, actionState, isRefreshingDetail } = props;

  if (detailState.status === "idle") {
    return (
      <div className="admin-advanced-report-queue__empty-state">
        <h2>Select a request</h2>
        <p>Pick a request from the queue to review its metadata, freshness, and raw payload.</p>
      </div>
    );
  }

  if (detailState.status === "loading") {
    return (
      <div className="admin-advanced-report-queue__feedback admin-advanced-report-queue__feedback--loading">
        <p>Loading request details...</p>
      </div>
    );
  }

  if (detailState.status === "error" || !detailState.data) {
    return (
      <div className="admin-advanced-report-queue__feedback admin-advanced-report-queue__feedback--error" role="alert">
        <p>{detailState.error ?? "Unable to load request details."}</p>
        <button
          className="admin-advanced-report-queue__button admin-advanced-report-queue__button--secondary"
          onClick={props.onRetryDetail}
          type="button"
        >
          Retry detail
        </button>
      </div>
    );
  }

  const request = detailState.data;
  const isPendingApproval = request.status === "pending_approval";
  const isSubmittingApproval = actionState.type === "submitting" && actionState.action === "approve";
  const isSubmittingRejection = actionState.type === "submitting" && actionState.action === "reject";
  const isActionDisabled = actionState.type === "submitting";

  return (
    <div className="admin-advanced-report-queue__detail-stack">
      <header className="admin-advanced-report-queue__detail-header">
        <div>
          <p className="admin-advanced-report-queue__eyebrow">Selected request</p>
          <h2>{request.channel.title}</h2>
          <p className="admin-advanced-report-queue__detail-meta">
            <code>{request.channel.youtubeChannelId}</code>
          </p>
        </div>
        <span
          className={`admin-advanced-report-queue__status admin-advanced-report-queue__status--${request.status}`}
        >
          {getAdminAdvancedReportStatusLabel(request.status)}
        </span>
      </header>

      <div className="admin-advanced-report-queue__detail-links">
        <Link
          className="admin-advanced-report-queue__link"
          href={`/catalog/${request.channel.id}`}
        >
          Open channel detail
        </Link>
        {isRefreshingDetail ? (
          <p className="admin-advanced-report-queue__inline-note" role="status">
            Refreshing selected request...
          </p>
        ) : null}
      </div>

      <div className="admin-advanced-report-queue__callout">
        <h3>Freshness</h3>
        <p>{getAdminAdvancedReportFreshnessCopy(request.lastCompletedReport)}</p>
      </div>

      <dl className="admin-advanced-report-queue__details">
        <div>
          <dt>Request ID</dt>
          <dd>
            <code>{request.id}</code>
          </dd>
        </div>
        <div>
          <dt>Requested by</dt>
          <dd>{request.requestedBy.email}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatTimestamp(request.createdAt)}</dd>
        </div>
        <div>
          <dt>Reviewed by</dt>
          <dd>{request.reviewedBy?.email ?? "Not reviewed yet"}</dd>
        </div>
        <div>
          <dt>Reviewed</dt>
          <dd>{formatTimestamp(request.reviewedAt)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatTimestamp(request.startedAt)}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{formatTimestamp(request.completedAt)}</dd>
        </div>
        <div>
          <dt>Last error</dt>
          <dd>{request.lastError ?? "No worker error recorded."}</dd>
        </div>
      </dl>

      {isPendingApproval ? (
        <section className="admin-advanced-report-queue__panel">
          <header className="admin-advanced-report-queue__panel-header">
            <h3>Decision</h3>
            <p>Approval actions stay non-optimistic and only update from the server response.</p>
          </header>

          <label className="admin-advanced-report-queue__field">
            <span>Decision note (optional)</span>
            <textarea
              onChange={(event) => {
                props.onDecisionNoteChange(event.target.value);
              }}
              rows={4}
              value={decisionNoteDraft}
            />
          </label>

          <div className="admin-advanced-report-queue__actions">
            <button
              className="admin-advanced-report-queue__button"
              disabled={isActionDisabled}
              onClick={() => {
                void props.onApprove();
              }}
              type="button"
            >
              {isSubmittingApproval ? "Approving..." : "Approve request"}
            </button>
            <button
              className="admin-advanced-report-queue__button admin-advanced-report-queue__button--secondary"
              disabled={isActionDisabled}
              onClick={() => {
                void props.onReject();
              }}
              type="button"
            >
              {isSubmittingRejection ? "Rejecting..." : "Reject request"}
            </button>
          </div>
        </section>
      ) : (
        <section className="admin-advanced-report-queue__panel">
          <header className="admin-advanced-report-queue__panel-header">
            <h3>Decision note</h3>
          </header>
          <p className="admin-advanced-report-queue__panel-copy">
            {request.decisionNote ?? "No approval decision note was recorded for this request."}
          </p>
        </section>
      )}

      {actionState.message ? (
        <p
          className={`admin-advanced-report-queue__action-status admin-advanced-report-queue__action-status--${actionState.type}`}
          role={actionState.type === "error" ? "alert" : "status"}
        >
          {actionState.message}
        </p>
      ) : null}

      {request.rawPayload ? (
        <details className="admin-advanced-report-queue__payload">
          <summary>Raw provider payload</summary>
          <pre>{serializeRawPayload(request.rawPayload)}</pre>
        </details>
      ) : null}
    </div>
  );
}

export function AdminAdvancedReportQueueView(
  props: AdminAdvancedReportQueueViewProps,
): ReactElement {
  const { listState, selectedRequestId, statusFilter, isRefreshingList } = props;

  return (
    <div className="admin-advanced-report-queue">
      <div className="admin-advanced-report-queue__toolbar">
        <div className="admin-advanced-report-queue__filters">
          <label className="admin-advanced-report-queue__field">
            <span>Show status</span>
            <select
              onChange={(event) => {
                props.onStatusFilterChange(event.target.value as AdvancedReportRequestStatus);
              }}
              value={statusFilter}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="admin-advanced-report-queue__button admin-advanced-report-queue__button--secondary"
            onClick={props.onReload}
            type="button"
          >
            Reload queue
          </button>
        </div>

        <div className="admin-advanced-report-queue__toolbar-copy">
          <Link className="admin-advanced-report-queue__link" href="/admin/imports">
            CSV imports
          </Link>
          <Link className="admin-advanced-report-queue__link" href="/admin/users">
            User management
          </Link>
          {isRefreshingList ? (
            <p className="admin-advanced-report-queue__inline-note" role="status">
              Refreshing queue...
            </p>
          ) : null}
        </div>
      </div>

      <div className="admin-advanced-report-queue__layout">
        <section className="admin-advanced-report-queue__panel" aria-labelledby="admin-advanced-report-queue-list-heading">
          <header className="admin-advanced-report-queue__panel-header">
            <h2 id="admin-advanced-report-queue-list-heading">Approval queue</h2>
            <p>Pending requests stay oldest-first. History filters let admins inspect finished decisions and worker outcomes.</p>
          </header>

          {listState.status === "loading" ? (
            <div className="admin-advanced-report-queue__feedback admin-advanced-report-queue__feedback--loading">
              <p>Loading advanced report requests...</p>
            </div>
          ) : null}

          {listState.status === "error" ? (
            <div className="admin-advanced-report-queue__feedback admin-advanced-report-queue__feedback--error" role="alert">
              <p>{listState.error ?? "Unable to load advanced report requests."}</p>
              <button
                className="admin-advanced-report-queue__button admin-advanced-report-queue__button--secondary"
                onClick={props.onRetryList}
                type="button"
              >
                Retry queue
              </button>
            </div>
          ) : null}

          {listState.status === "ready" && listState.items.length === 0 ? (
            <div className="admin-advanced-report-queue__empty-state">
              <h3>No requests</h3>
              <p>{getAdminAdvancedReportEmptyStateCopy(statusFilter)}</p>
            </div>
          ) : null}

          {listState.status === "ready" && listState.items.length > 0 ? (
            <ul className="admin-advanced-report-queue__list">
              {listState.items.map((request) => {
                const isSelected = request.id === selectedRequestId;

                return (
                  <li key={request.id}>
                    <button
                      className={`admin-advanced-report-queue__list-item${isSelected ? " admin-advanced-report-queue__list-item--selected" : ""}`}
                      onClick={() => {
                        props.onSelectRequest(request.id);
                      }}
                      type="button"
                    >
                      <div className="admin-advanced-report-queue__list-item-header">
                        <div>
                          <h3>{request.channel.title}</h3>
                          <p>
                            <code>{request.channel.youtubeChannelId}</code>
                          </p>
                        </div>
                        <span
                          className={`admin-advanced-report-queue__status admin-advanced-report-queue__status--${request.status}`}
                        >
                          {getAdminAdvancedReportStatusLabel(request.status)}
                        </span>
                      </div>

                      <dl className="admin-advanced-report-queue__list-details">
                        <div>
                          <dt>Requested by</dt>
                          <dd>{request.requestedBy.email}</dd>
                        </div>
                        <div>
                          <dt>Created</dt>
                          <dd>{formatTimestamp(request.createdAt)}</dd>
                        </div>
                      </dl>

                      <p className="admin-advanced-report-queue__list-copy">
                        {getAdminAdvancedReportFreshnessCopy(request.lastCompletedReport)}
                      </p>
                      <p className="admin-advanced-report-queue__list-copy">
                        {getAdminAdvancedReportListSnippet(request)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <section className="admin-advanced-report-queue__panel" aria-labelledby="admin-advanced-report-queue-detail-heading">
          <header className="admin-advanced-report-queue__panel-header">
            <h2 id="admin-advanced-report-queue-detail-heading">Request detail</h2>
            <p>Inspect request metadata, freshness context, and the raw payload reserved for admins.</p>
          </header>

          {renderDetailState(props)}
        </section>
      </div>
    </div>
  );
}

export function AdminAdvancedReportQueue() {
  const [statusFilter, setStatusFilter] = useState<AdvancedReportRequestStatus>("pending_approval");
  const [listState, setListState] = useState<AdminAdvancedReportListState>(INITIAL_LIST_STATE);
  const [detailState, setDetailState] = useState<AdminAdvancedReportDetailState>(INITIAL_DETAIL_STATE);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [decisionNoteDraft, setDecisionNoteDraft] = useState("");
  const [actionState, setActionState] = useState<AdminAdvancedReportActionState>(IDLE_ACTION_STATE);
  const [listReloadToken, setListReloadToken] = useState(0);
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  const [isRefreshingList, setIsRefreshingList] = useState(false);
  const [isRefreshingDetail, setIsRefreshingDetail] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    const keepCurrentListVisible = listState.status === "ready";

    if (!keepCurrentListVisible) {
      setListState(INITIAL_LIST_STATE);
    } else {
      setIsRefreshingList(true);
    }

    async function loadRequests(): Promise<void> {
      try {
        const items = await fetchAdminAdvancedReportRequests(
          { status: statusFilter },
          abortController.signal,
        );

        if (abortController.signal.aborted) {
          return;
        }

        setListState({
          status: "ready",
          items,
          error: null,
        });

        const nextSelectedRequestId = resolveNextSelectedRequestId(selectedRequestId, items);

        if (nextSelectedRequestId !== selectedRequestId) {
          setSelectedRequestId(nextSelectedRequestId);
          setActionState(IDLE_ACTION_STATE);

          if (nextSelectedRequestId === null) {
            setDecisionNoteDraft("");
            setDetailState(INITIAL_DETAIL_STATE);
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setListState({
          status: "error",
          items: [],
          error: getListErrorMessage(error),
        });
        setSelectedRequestId(null);
        setDetailState(INITIAL_DETAIL_STATE);
        setDecisionNoteDraft("");
      } finally {
        if (!abortController.signal.aborted) {
          setIsRefreshingList(false);
        }
      }
    }

    void loadRequests();

    return () => {
      abortController.abort();
    };
  }, [statusFilter, listReloadToken]);

  useEffect(() => {
    if (!selectedRequestId) {
      setDetailState(INITIAL_DETAIL_STATE);
      setDecisionNoteDraft("");
      setIsRefreshingDetail(false);
      return;
    }

    const requestId = selectedRequestId;

    const abortController = new AbortController();
    const keepCurrentDetailVisible =
      detailState.status === "ready" && detailState.data?.id === requestId;

    if (!keepCurrentDetailVisible) {
      setDetailState({
        status: "loading",
        data: null,
        error: null,
      });
    } else {
      setIsRefreshingDetail(true);
    }

    async function loadRequestDetail(): Promise<void> {
      try {
        const detail = await fetchAdminAdvancedReportRequestDetail(requestId, abortController.signal);

        if (abortController.signal.aborted) {
          return;
        }

        setDetailState({
          status: "ready",
          data: detail,
          error: null,
        });
        setDecisionNoteDraft(detail.decisionNote ?? "");
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setDetailState({
          status: "error",
          data: null,
          error: getDetailErrorMessage(error),
        });
      } finally {
        if (!abortController.signal.aborted) {
          setIsRefreshingDetail(false);
        }
      }
    }

    void loadRequestDetail();

    return () => {
      abortController.abort();
    };
  }, [selectedRequestId, detailReloadToken]);

  useEffect(() => {
    const shouldPollList =
      listState.status === "ready" &&
      shouldPollAdminAdvancedReportList({
        statusFilter,
        items: listState.items,
      });
    const shouldPollDetail =
      detailState.status === "ready" &&
      statusFilter !== "pending_approval" &&
      shouldPollAdminAdvancedReportDetail(detailState.data);

    if (!shouldPollList && !shouldPollDetail) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (shouldPollList) {
        setListReloadToken((current) => current + 1);
      }

      if (shouldPollDetail) {
        setDetailReloadToken((current) => current + 1);
      }
    }, ADMIN_ADVANCED_REPORT_POLL_INTERVAL_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [statusFilter, listState, detailState]);

  function handleStatusFilterChange(nextStatus: AdvancedReportRequestStatus): void {
    if (nextStatus === statusFilter) {
      return;
    }

    setStatusFilter(nextStatus);
    setListState(INITIAL_LIST_STATE);
    setDetailState(INITIAL_DETAIL_STATE);
    setSelectedRequestId(null);
    setDecisionNoteDraft("");
    setActionState(IDLE_ACTION_STATE);
    setIsRefreshingList(false);
    setIsRefreshingDetail(false);
  }

  function handleReload(): void {
    setActionState(IDLE_ACTION_STATE);
    setListReloadToken((current) => current + 1);

    if (selectedRequestId) {
      setDetailReloadToken((current) => current + 1);
    }
  }

  function handleRetryList(): void {
    setListState(INITIAL_LIST_STATE);
    setListReloadToken((current) => current + 1);
  }

  function handleRetryDetail(): void {
    if (!selectedRequestId) {
      return;
    }

    setDetailState({
      status: "loading",
      data: null,
      error: null,
    });
    setDetailReloadToken((current) => current + 1);
  }

  function handleSelectRequest(requestId: string): void {
    if (requestId === selectedRequestId) {
      return;
    }

    setSelectedRequestId(requestId);
    setDetailState({
      status: "loading",
      data: null,
      error: null,
    });
    setDecisionNoteDraft("");
    setActionState(IDLE_ACTION_STATE);
  }

  async function handleDecision(action: "approve" | "reject"): Promise<void> {
    if (detailState.status !== "ready" || detailState.data?.status !== "pending_approval") {
      return;
    }

    const requestId = detailState.data.id;

    setActionState({
      type: "submitting",
      action,
      message: "",
    });

    try {
      const detail =
        action === "approve"
          ? await approveAdminAdvancedReportRequest(requestId, {
              decisionNote: decisionNoteDraft.trim() || undefined,
            })
          : await rejectAdminAdvancedReportRequest(requestId, {
              decisionNote: decisionNoteDraft.trim() || undefined,
            });

      setDetailState({
        status: "ready",
        data: detail,
        error: null,
      });
      setDecisionNoteDraft(detail.decisionNote ?? "");
      setActionState({
        type: "success",
        action: null,
        message: getDecisionSuccessMessage(action),
      });
      setListReloadToken((current) => current + 1);
    } catch (error) {
      setActionState({
        type: "error",
        action,
        message: getDecisionErrorMessage(error),
      });

      if (error instanceof AdminAdvancedReportApiError && error.status === 409) {
        setListReloadToken((current) => current + 1);
        setDetailReloadToken((current) => current + 1);
      }
    }
  }

  return (
    <AdminAdvancedReportQueueView
      actionState={actionState}
      decisionNoteDraft={decisionNoteDraft}
      detailState={detailState}
      isRefreshingDetail={isRefreshingDetail}
      isRefreshingList={isRefreshingList}
      listState={listState}
      onApprove={() => handleDecision("approve")}
      onDecisionNoteChange={setDecisionNoteDraft}
      onReject={() => handleDecision("reject")}
      onReload={handleReload}
      onRetryDetail={handleRetryDetail}
      onRetryList={handleRetryList}
      onSelectRequest={handleSelectRequest}
      onStatusFilterChange={handleStatusFilterChange}
      selectedRequestId={selectedRequestId}
      statusFilter={statusFilter}
    />
  );
}
