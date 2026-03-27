"use client";

import type {
  AdminAdvancedReportRequestDetail,
  AdminAdvancedReportRequestSummary,
  AdvancedReportRequestStatus,
} from "@scouting-platform/contracts";
import Link from "next/link";
import React from "react";
import { useEffect, useState, type ReactElement } from "react";

import {
  AdminAdvancedReportApiError,
  approveAdminAdvancedReportRequest,
  fetchAdminAdvancedReportRequestDetail,
  fetchAdminAdvancedReportRequests,
  rejectAdminAdvancedReportRequest,
} from "../../lib/admin-advanced-reports-api";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";

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
  onStatusFilterChange: (value: AdvancedReportRequestStatus) => void;
  onRetryList: () => void;
  onRetryDetail: () => void;
  onCloseDetail: () => void;
  onSelectRequest: (requestId: string) => void;
  onDecisionNoteChange: (value: string) => void;
  onApprove: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
}>;

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

const STATUS_SELECT_OPTIONS: SearchableSelectOption[] = STATUS_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

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

function getAdminAdvancedReportListStatusCopy(
  request: Pick<AdminAdvancedReportRequestSummary, "decisionNote" | "lastError" | "status">,
): string {
  if (request.lastError) {
    return request.lastError;
  }

  if (request.decisionNote) {
    return request.decisionNote;
  }

  if (request.status === "pending_approval") {
    return "Awaiting review";
  }

  if (request.status === "approved") {
    return "Approved";
  }

  if (request.status === "queued" || request.status === "running") {
    return "In progress";
  }

  return "No note";
}

function getAdminAdvancedReportEmptyStateCopy(statusFilter: AdvancedReportRequestStatus): string {
  if (statusFilter === "pending_approval") {
    return "No pending approval requests right now.";
  }

  return `No ${getAdminAdvancedReportStatusLabel(statusFilter).toLowerCase()} requests found.`;
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
    return "Approval recorded.";
  }

  return "Rejection recorded.";
}

function serializeRawPayload(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "Raw payload could not be serialized.";
  }
}

function renderDetailContent(props: AdminAdvancedReportQueueViewProps): ReactElement {
  const { detailState, decisionNoteDraft, actionState } = props;

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
      <header className="database-admin__modal-header">
        <div>
          <p className="workspace-eyebrow">Approval request</p>
          <h3>{request.channel.title}</h3>
          <p className="admin-advanced-report-queue__detail-meta">
            <code>{request.channel.youtubeChannelId}</code>
          </p>
        </div>
        <button className="database-admin__modal-close" onClick={props.onCloseDetail} type="button">
          Close
        </button>
      </header>

      <div className="admin-advanced-report-queue__detail-header">
        <span
          className={`admin-advanced-report-queue__status admin-advanced-report-queue__status--${request.status}`}
        >
          {getAdminAdvancedReportStatusLabel(request.status)}
        </span>
        <Link className="admin-advanced-report-queue__link" href={`/catalog/${request.channel.id}`}>
          Open channel detail
        </Link>
      </div>

      <div className="admin-advanced-report-queue__callout">
        <h3>Freshness</h3>
        <p>{getAdminAdvancedReportFreshnessCopy(request.lastCompletedReport)}</p>
      </div>

      <dl className="admin-advanced-report-queue__details">
        <div>
          <dt>Request ID</dt>
          <dd><code>{request.id}</code></dd>
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
            <p>Review the request and record the decision from this dialog.</p>
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
              {isSubmittingApproval ? "Approving..." : "Approve"}
            </button>
            <button
              className="admin-advanced-report-queue__button admin-advanced-report-queue__button--secondary"
              disabled={isActionDisabled}
              onClick={() => {
                void props.onReject();
              }}
              type="button"
            >
              {isSubmittingRejection ? "Rejecting..." : "Reject"}
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

export function AdminAdvancedReportQueueView(props: AdminAdvancedReportQueueViewProps): ReactElement {
  const { listState, selectedRequestId, statusFilter } = props;
  const isDetailOpen = selectedRequestId !== null;

  return (
    <div className="admin-advanced-report-queue">
      <div className="admin-advanced-report-queue__controls">
        <label className="admin-advanced-report-queue__field">
          <span>Status</span>
          <SearchableSelect
            ariaLabel="Status"
            onChange={(value) => {
              props.onStatusFilterChange(value as AdvancedReportRequestStatus);
            }}
            options={STATUS_SELECT_OPTIONS}
            placeholder="Select status"
            searchPlaceholder="Search statuses..."
            value={statusFilter}
          />
        </label>
      </div>

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
            Retry
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
        <div className="admin-advanced-report-queue__table-shell">
          <table className="admin-advanced-report-queue__table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Requested by</th>
                <th>Status</th>
                <th>Created</th>
                <th>Last completed report</th>
                <th>Note / error</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {listState.items.map((request) => (
                <tr className="admin-advanced-report-queue__table-row" key={request.id}>
                  <td className="admin-advanced-report-queue__primary-cell">
                    <div className="admin-advanced-report-queue__channel-cell">
                      <span>{request.channel.title}</span>
                      <code>{request.channel.youtubeChannelId}</code>
                    </div>
                  </td>
                  <td>{request.requestedBy.email}</td>
                  <td>
                    <span
                      className={`admin-advanced-report-queue__status admin-advanced-report-queue__status--${request.status}`}
                    >
                      {getAdminAdvancedReportStatusLabel(request.status)}
                    </span>
                  </td>
                  <td>{formatTimestamp(request.createdAt)}</td>
                  <td>{getAdminAdvancedReportFreshnessCopy(request.lastCompletedReport)}</td>
                  <td>{getAdminAdvancedReportListStatusCopy(request)}</td>
                  <td>
                    <button
                      className="admin-advanced-report-queue__button admin-advanced-report-queue__button--secondary"
                      onClick={() => {
                        props.onSelectRequest(request.id);
                      }}
                      type="button"
                    >
                      Open details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {isDetailOpen ? (
        <div className="database-admin__modal-backdrop" onClick={props.onCloseDetail} role="presentation">
          <div
            aria-labelledby="admin-approval-detail-title"
            aria-modal="true"
            className="database-admin__modal admin-advanced-report-queue__modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
            role="dialog"
          >
            <div id="admin-approval-detail-title" className="admin-advanced-report-queue__sr-only">
              Approval request detail
            </div>
            {renderDetailContent(props)}
          </div>
        </div>
      ) : null}
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

  useEffect(() => {
    const abortController = new AbortController();
    setListState(INITIAL_LIST_STATE);

    void (async () => {
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
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setListState({
          status: "error",
          items: [],
          error: getListErrorMessage(error),
        });
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [statusFilter, listReloadToken]);

  useEffect(() => {
    if (!selectedRequestId) {
      setDetailState(INITIAL_DETAIL_STATE);
      setDecisionNoteDraft("");
      return;
    }

    const abortController = new AbortController();
    setDetailState({
      status: "loading",
      data: null,
      error: null,
    });

    void (async () => {
      try {
        const detail = await fetchAdminAdvancedReportRequestDetail(selectedRequestId, abortController.signal);

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
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [selectedRequestId, detailReloadToken]);

  function handleStatusFilterChange(nextStatus: AdvancedReportRequestStatus): void {
    if (nextStatus === statusFilter) {
      return;
    }

    setStatusFilter(nextStatus);
    setSelectedRequestId(null);
    setDecisionNoteDraft("");
    setActionState(IDLE_ACTION_STATE);
  }

  function handleRetryList(): void {
    setListReloadToken((current) => current + 1);
  }

  function handleRetryDetail(): void {
    if (!selectedRequestId) {
      return;
    }

    setDetailReloadToken((current) => current + 1);
  }

  function handleCloseDetail(): void {
    setSelectedRequestId(null);
    setDecisionNoteDraft("");
    setActionState(IDLE_ACTION_STATE);
    setDetailState(INITIAL_DETAIL_STATE);
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
    }
  }

  return (
    <AdminAdvancedReportQueueView
      actionState={actionState}
      decisionNoteDraft={decisionNoteDraft}
      detailState={detailState}
      listState={listState}
      onApprove={() => handleDecision("approve")}
      onCloseDetail={handleCloseDetail}
      onDecisionNoteChange={setDecisionNoteDraft}
      onReject={() => handleDecision("reject")}
      onRetryDetail={handleRetryDetail}
      onRetryList={handleRetryList}
      onSelectRequest={(requestId) => {
        setSelectedRequestId(requestId);
        setActionState(IDLE_ACTION_STATE);
      }}
      onStatusFilterChange={handleStatusFilterChange}
      selectedRequestId={selectedRequestId}
      statusFilter={statusFilter}
    />
  );
}
