"use client";

import type {
  HubspotPushBatchDetail,
  HubspotPushBatchRow,
  HubspotPushBatchRowStatus,
  HubspotPushBatchStatus,
  HubspotPushBatchSummary,
} from "@scouting-platform/contracts";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";

import {
  HubspotPushBatchesApiError,
  fetchHubspotPushBatches,
  fetchHubspotPushBatchDetail,
} from "../../lib/hubspot-push-batches-api";

type HubspotPushHistoryState = {
  status: "loading" | "error" | "ready";
  items: HubspotPushBatchSummary[];
  error: string | null;
};

type HubspotPushDetailState = {
  requestState: "idle" | "loading" | "error" | "ready";
  data: HubspotPushBatchDetail | null;
  error: string | null;
};

type HubspotPushManagerViewProps = Readonly<{
  historyState: HubspotPushHistoryState;
  detailState: HubspotPushDetailState;
  selectedBatchId: string | null;
  isRefreshingHistory: boolean;
  isRefreshingDetail: boolean;
  catalogHref: string;
  onReloadHistory: () => void;
  onRetryHistory: () => void;
  onRetryDetail: () => void;
  onSelectBatch: (batchId: string) => void;
}>;

const ACTIVE_POLLING_STATUSES = new Set<HubspotPushBatchStatus>(["queued", "running"]);
const INITIAL_HISTORY_STATE: HubspotPushHistoryState = {
  status: "loading",
  items: [],
  error: null,
};
const INITIAL_DETAIL_STATE: HubspotPushDetailState = {
  requestState: "idle",
  data: null,
  error: null,
};

export const HUBSPOT_PUSH_HISTORY_POLL_INTERVAL_MS = 3000;

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

function getRequestedByLabel(batch: Pick<HubspotPushBatchSummary, "requestedBy">): string {
  return batch.requestedBy.name?.trim() || batch.requestedBy.email;
}

function formatNullableCell(value: string | null): string {
  return value?.trim() || "Not provided";
}

function getHistorySnippet(batch: HubspotPushBatchSummary): string {
  switch (batch.status) {
    case "queued":
      return "Queued and refreshing automatically.";
    case "running":
      return "Running in the background and refreshing automatically.";
    case "completed":
      return `${batch.pushedRowCount} pushed · ${batch.failedRowCount} failed.`;
    case "failed":
      return batch.lastError
        ? `Failed: ${batch.lastError}`
        : "Failed before the worker completed.";
    default:
      return batch.status;
  }
}

function getRowResultCopy(row: HubspotPushBatchRow): string {
  switch (row.status) {
    case "pushed":
      return row.hubspotObjectId
        ? `Pushed to HubSpot as ${row.hubspotObjectId}.`
        : "Pushed to HubSpot.";
    case "failed":
      return row.errorMessage ?? "HubSpot push failed.";
    case "pending":
      return "Waiting for the worker to process this row.";
    default:
      return row.status;
  }
}

function getHistoryErrorMessage(error: unknown): string {
  if (error instanceof HubspotPushBatchesApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow HubSpot push history review anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to load HubSpot push history. Please try again.");
}

function getDetailErrorMessage(error: unknown): string {
  if (error instanceof HubspotPushBatchesApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow HubSpot push batch review anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to load HubSpot push batch details. Please try again.");
}

export function formatHubspotPushStatusLabel(
  status: HubspotPushBatchStatus | HubspotPushBatchRowStatus,
): string {
  return toTitleCase(status);
}

export function shouldPollHubspotPushHistory(
  items: readonly Pick<HubspotPushBatchSummary, "status">[],
): boolean {
  return items.some((item) => ACTIVE_POLLING_STATUSES.has(item.status));
}

export function shouldPollHubspotPushDetail(
  batch: Pick<HubspotPushBatchDetail, "status"> | null,
): boolean {
  if (!batch) {
    return false;
  }

  return ACTIVE_POLLING_STATUSES.has(batch.status);
}

export function buildHubspotPushWorkspaceHref(pathname: string, batchId: string | null): string {
  if (!batchId) {
    return pathname;
  }

  const searchParams = new URLSearchParams();
  searchParams.set("batchId", batchId);

  return `${pathname}?${searchParams.toString()}`;
}

function resolveSelectedBatchId(
  requestedBatchId: string | null,
  items: readonly HubspotPushBatchSummary[],
): string | null {
  if (items.length === 0) {
    return null;
  }

  if (requestedBatchId && items.some((item) => item.id === requestedBatchId)) {
    return requestedBatchId;
  }

  return items[0]?.id ?? null;
}

function renderHistoryState(props: HubspotPushManagerViewProps): ReactElement {
  const { historyState, selectedBatchId, isRefreshingHistory, onRetryHistory, onSelectBatch } = props;

  if (historyState.status === "loading" && historyState.items.length === 0) {
    return (
      <div className="hubspot-push__feedback hubspot-push__feedback--loading" role="status">
        <p>Loading HubSpot push history...</p>
      </div>
    );
  }

  if (historyState.status === "error" && historyState.items.length === 0) {
    return (
      <div className="hubspot-push__feedback hubspot-push__feedback--error" role="alert">
        <p>{historyState.error ?? "Unable to load HubSpot push history."}</p>
        <button className="hubspot-push__button" onClick={onRetryHistory} type="button">
          Retry history
        </button>
      </div>
    );
  }

  if (historyState.items.length === 0) {
    return (
      <div className="hubspot-push__empty-state">
        <h3>No HubSpot push history yet</h3>
        <p>Start a selected creator push from the catalog to build review history here.</p>
        <Link className="hubspot-push__link" href={props.catalogHref}>
          Open catalog to start a push
        </Link>
      </div>
    );
  }

  return (
    <div className="hubspot-push__history-stack">
      {isRefreshingHistory ? (
        <p className="hubspot-push__inline-note" role="status">
          Refreshing HubSpot push history...
        </p>
      ) : null}

      {historyState.error ? (
        <p className="hubspot-push__history-error" role="alert">
          Last refresh failed: {historyState.error}
        </p>
      ) : null}

      <ul className="hubspot-push__list">
        {historyState.items.map((batch) => {
          const isSelected = batch.id === selectedBatchId;

          return (
            <li key={batch.id}>
              <button
                className={`hubspot-push__list-item${
                  isSelected ? " hubspot-push__list-item--selected" : ""
                }`}
                onClick={() => {
                  onSelectBatch(batch.id);
                }}
                type="button"
              >
                <div className="hubspot-push__list-item-header">
                  <div>
                    <p className="hubspot-push__eyebrow">Selected push</p>
                    <h3>{getRequestedByLabel(batch)}</h3>
                    <p className="hubspot-push__panel-copy">
                      Created {formatTimestamp(batch.createdAt)}
                    </p>
                  </div>
                  <span className={`hubspot-push__status hubspot-push__status--${batch.status}`}>
                    {formatHubspotPushStatusLabel(batch.status)}
                  </span>
                </div>

                <p className="hubspot-push__list-copy">{getHistorySnippet(batch)}</p>

                <dl className="hubspot-push__details">
                  <div>
                    <dt>Total</dt>
                    <dd>{batch.totalRowCount}</dd>
                  </div>
                  <div>
                    <dt>Pushed</dt>
                    <dd>{batch.pushedRowCount}</dd>
                  </div>
                  <div>
                    <dt>Failed</dt>
                    <dd>{batch.failedRowCount}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatTimestamp(batch.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>Completed</dt>
                    <dd>{formatTimestamp(batch.completedAt)}</dd>
                  </div>
                </dl>

                {batch.lastError ? (
                  <p className="hubspot-push__history-error">{batch.lastError}</p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function renderDetailState(props: HubspotPushManagerViewProps): ReactElement {
  const { detailState, isRefreshingDetail, onRetryDetail } = props;

  if (detailState.requestState === "idle") {
    return (
      <div className="hubspot-push__empty-state">
        <h2>Select a HubSpot batch</h2>
        <p>Pick a recent batch to inspect row-level results, timestamps, and any visible failures.</p>
      </div>
    );
  }

  if (detailState.requestState === "loading" && !detailState.data) {
    return (
      <div className="hubspot-push__feedback hubspot-push__feedback--loading" role="status">
        <p>Loading HubSpot push batch details...</p>
      </div>
    );
  }

  if (detailState.requestState === "error" && !detailState.data) {
    return (
      <div className="hubspot-push__feedback hubspot-push__feedback--error" role="alert">
        <p>{detailState.error ?? "Unable to load HubSpot push batch details."}</p>
        <button
          className="hubspot-push__button hubspot-push__button--secondary"
          onClick={onRetryDetail}
          type="button"
        >
          Retry detail
        </button>
      </div>
    );
  }

  const batch = detailState.data;

  if (!batch) {
    return (
      <div className="hubspot-push__feedback hubspot-push__feedback--error" role="alert">
        <p>Unable to load HubSpot push batch details.</p>
      </div>
    );
  }

  return (
    <div className="hubspot-push__detail-stack">
      <header className="hubspot-push__detail-header">
        <div>
          <p className="hubspot-push__eyebrow">Selected batch</p>
          <h2>{getRequestedByLabel(batch)}</h2>
          <p className="hubspot-push__detail-meta">
            <code>{batch.id}</code>
          </p>
        </div>
        <span className={`hubspot-push__status hubspot-push__status--${batch.status}`}>
          {formatHubspotPushStatusLabel(batch.status)}
        </span>
      </header>

      {isRefreshingDetail ? (
        <p className="hubspot-push__inline-note" role="status">
          Refreshing selected batch...
        </p>
      ) : null}

      {detailState.error ? (
        <p className="hubspot-push__history-error" role="alert">
          Last refresh failed: {detailState.error}
        </p>
      ) : null}

      <div className="hubspot-push__callout">
        <h3>Batch summary</h3>
        <p>
          {batch.pushedRowCount} pushed · {batch.failedRowCount} failed · {batch.totalRowCount} total
        </p>
      </div>

      <dl className="hubspot-push__details">
        <div>
          <dt>Requested by</dt>
          <dd>{batch.requestedBy.email}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatTimestamp(batch.createdAt)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatTimestamp(batch.startedAt)}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{formatTimestamp(batch.completedAt)}</dd>
        </div>
        <div>
          <dt>Last error</dt>
          <dd>{batch.lastError ?? "No batch-level worker error recorded."}</dd>
        </div>
      </dl>

      {batch.rows.length === 0 ? (
        <div className="hubspot-push__empty-state">
          <h3>No stored rows</h3>
          <p>This batch has no stored row results yet.</p>
        </div>
      ) : (
        <div className="hubspot-push__table-wrap">
          <table className="hubspot-push__table">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Contact</th>
                <th scope="col">Channel</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {batch.rows.map((row) => (
                <tr
                  className={
                    row.status === "failed"
                      ? "hubspot-push__table-row hubspot-push__table-row--failed"
                      : "hubspot-push__table-row"
                  }
                  key={row.id}
                >
                  <td>
                    <span className={`hubspot-push__status hubspot-push__status--${row.status}`}>
                      {formatHubspotPushStatusLabel(row.status)}
                    </span>
                  </td>
                  <td>{formatNullableCell(row.contactEmail)}</td>
                  <td>
                    <code>{row.channelId}</code>
                  </td>
                  <td>
                    {getRowResultCopy(row)}
                    {row.status === "pushed" && row.hubspotObjectId ? (
                      <div className="hubspot-push__cell-copy">{row.hubspotObjectId}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function HubspotPushManagerView(props: HubspotPushManagerViewProps): ReactElement {
  const { historyState, catalogHref, onReloadHistory } = props;

  return (
    <div className="hubspot-push">
      <div className="hubspot-push__toolbar">
        <div className="hubspot-push__toolbar-copy">
          <p className="hubspot-push__eyebrow">Week 6 workspace</p>
          <h2>HubSpot push batches</h2>
          <p className="hubspot-push__panel-copy">
            Review selected creator pushes, inspect stored failures, and jump back to the catalog when you need to start the next batch.
          </p>
        </div>

        <div className="hubspot-push__toolbar-actions">
          <Link className="hubspot-push__link" href={catalogHref}>
            Open catalog to start a push
          </Link>
          <button
            className="hubspot-push__button hubspot-push__button--secondary"
            disabled={historyState.status === "loading"}
            onClick={onReloadHistory}
            type="button"
          >
            Refresh history
          </button>
        </div>
      </div>

      <div className="hubspot-push__layout">
        <section className="hubspot-push__panel" aria-labelledby="hubspot-push-history-heading">
          <header className="hubspot-push__panel-header">
            <h2 id="hubspot-push-history-heading">Recent push history</h2>
            <p>Newest batches appear first and auto-refresh while background work is still queued or running.</p>
          </header>

          {renderHistoryState(props)}
        </section>

        <section className="hubspot-push__panel" aria-labelledby="hubspot-push-detail-heading">
          <header className="hubspot-push__panel-header">
            <h2 id="hubspot-push-detail-heading">Batch detail</h2>
            <p>Inspect row-level outcomes, exact failure messages, and timing for the selected batch.</p>
          </header>

          {renderDetailState(props)}
        </section>
      </div>
    </div>
  );
}

export function HubspotPushManager() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedBatchId = searchParams.get("batchId");
  const [historyState, setHistoryState] = useState<HubspotPushHistoryState>(INITIAL_HISTORY_STATE);
  const [detailState, setDetailState] = useState<HubspotPushDetailState>(INITIAL_DETAIL_STATE);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(requestedBatchId);
  const [historyReloadToken, setHistoryReloadToken] = useState(0);
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
  const [isRefreshingDetail, setIsRefreshingDetail] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    const keepCurrentListVisible = historyState.status === "ready";

    if (!keepCurrentListVisible) {
      setHistoryState(INITIAL_HISTORY_STATE);
    } else {
      setIsRefreshingHistory(true);
    }

    void (async () => {
      try {
        const items = await fetchHubspotPushBatches(abortController.signal);

        if (abortController.signal.aborted) {
          return;
        }

        setHistoryState({
          status: "ready",
          items,
          error: null,
        });
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        const message = getHistoryErrorMessage(error);

        setHistoryState((current) => {
          if (current.status === "ready") {
            return {
              status: "ready",
              items: current.items,
              error: message,
            };
          }

          return {
            status: "error",
            items: [],
            error: message,
          };
        });
      } finally {
        if (!abortController.signal.aborted) {
          setIsRefreshingHistory(false);
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [historyReloadToken]);

  useEffect(() => {
    if (historyState.status !== "ready") {
      return;
    }

    const nextSelectedBatchId = resolveSelectedBatchId(requestedBatchId, historyState.items);
    const nextHref = buildHubspotPushWorkspaceHref(pathname, nextSelectedBatchId);
    const currentHref = buildHubspotPushWorkspaceHref(pathname, requestedBatchId);

    setSelectedBatchId(nextSelectedBatchId);

    if (nextHref !== currentHref) {
      router.replace(nextHref);
    }
  }, [historyState, pathname, requestedBatchId, router]);

  useEffect(() => {
    if (!selectedBatchId) {
      setDetailState(INITIAL_DETAIL_STATE);
      setIsRefreshingDetail(false);
      return;
    }

    const abortController = new AbortController();
    const keepCurrentDetailVisible =
      detailState.requestState === "ready" && detailState.data?.id === selectedBatchId;

    if (!keepCurrentDetailVisible) {
      setDetailState({
        requestState: "loading",
        data: null,
        error: null,
      });
    } else {
      setIsRefreshingDetail(true);
    }

    const batchId = selectedBatchId;

    void (async () => {
      try {
        const detail = await fetchHubspotPushBatchDetail(batchId, abortController.signal);

        if (abortController.signal.aborted) {
          return;
        }

        setDetailState({
          requestState: "ready",
          data: detail,
          error: null,
        });
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        const message = getDetailErrorMessage(error);

        setDetailState((current) => {
          if (current.requestState === "ready" && current.data?.id === batchId) {
            return {
              requestState: "ready",
              data: current.data,
              error: message,
            };
          }

          return {
            requestState: "error",
            data: null,
            error: message,
          };
        });
      } finally {
        if (!abortController.signal.aborted) {
          setIsRefreshingDetail(false);
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [selectedBatchId, detailReloadToken]);

  useEffect(() => {
    const shouldPollHistory =
      historyState.status === "ready" &&
      !isRefreshingHistory &&
      shouldPollHubspotPushHistory(historyState.items);
    const shouldPollDetail =
      detailState.requestState === "ready" &&
      !isRefreshingDetail &&
      shouldPollHubspotPushDetail(detailState.data);

    if (!shouldPollHistory && !shouldPollDetail) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (shouldPollHistory) {
        setHistoryReloadToken((current) => current + 1);
      }

      if (shouldPollDetail) {
        setDetailReloadToken((current) => current + 1);
      }
    }, HUBSPOT_PUSH_HISTORY_POLL_INTERVAL_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [historyState, detailState, isRefreshingHistory, isRefreshingDetail]);

  function handleReloadHistory(): void {
    setHistoryReloadToken((current) => current + 1);
  }

  function handleRetryHistory(): void {
    setHistoryState(INITIAL_HISTORY_STATE);
    setHistoryReloadToken((current) => current + 1);
  }

  function handleRetryDetail(): void {
    setDetailReloadToken((current) => current + 1);
  }

  function handleSelectBatch(batchId: string): void {
    if (batchId === selectedBatchId) {
      return;
    }

    setSelectedBatchId(batchId);
    router.replace(buildHubspotPushWorkspaceHref(pathname, batchId));
  }

  return (
    <HubspotPushManagerView
      catalogHref="/catalog"
      detailState={detailState}
      historyState={historyState}
      isRefreshingDetail={isRefreshingDetail}
      isRefreshingHistory={isRefreshingHistory}
      onReloadHistory={handleReloadHistory}
      onRetryDetail={handleRetryDetail}
      onRetryHistory={handleRetryHistory}
      onSelectBatch={handleSelectBatch}
      selectedBatchId={selectedBatchId}
    />
  );
}
