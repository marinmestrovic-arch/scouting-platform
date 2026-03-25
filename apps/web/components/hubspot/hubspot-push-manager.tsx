"use client";

import type {
  HubspotImportBatchDetail,
  HubspotImportBatchRow,
  HubspotImportBatchRowStatus,
  HubspotImportBatchStatus,
  HubspotImportBatchSummary,
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
  fetchHubspotImportBatchDetail,
  fetchHubspotImportBatches,
  getHubspotImportBatchDownloadUrl,
  HubspotImportBatchesApiError,
} from "../../lib/hubspot-import-batches-api";
import {
  fetchHubspotPushBatchDetail,
  fetchHubspotPushBatches,
  HubspotPushBatchesApiError,
} from "../../lib/hubspot-push-batches-api";
import { getHubspotPushBatchResultHref } from "../../lib/navigation";

type HubspotWorkspaceHistoryItem =
  | { kind: "import"; summary: HubspotImportBatchSummary }
  | { kind: "legacy"; summary: HubspotPushBatchSummary };

type HubspotWorkspaceDetail =
  | { kind: "import"; batch: HubspotImportBatchDetail }
  | { kind: "legacy"; batch: HubspotPushBatchDetail };

type HubspotPushHistoryState = {
  status: "loading" | "error" | "ready";
  items: HubspotWorkspaceHistoryItem[];
  error: string | null;
};

type HubspotPushDetailState = {
  requestState: "idle" | "loading" | "error" | "ready";
  data: HubspotWorkspaceDetail | null;
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

const ACTIVE_POLLING_STATUSES = new Set<HubspotImportBatchStatus | HubspotPushBatchStatus>([
  "queued",
  "running",
]);

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

function getHistoryItemId(item: HubspotWorkspaceHistoryItem): string {
  return item.summary.id;
}


function getRequestedByLabel(
  item: Pick<HubspotImportBatchSummary, "requestedBy"> | Pick<HubspotPushBatchSummary, "requestedBy">,
): string {
  return item.requestedBy.name?.trim() || item.requestedBy.email;
}

function formatNullableCell(value: string | null): string {
  return value?.trim() || "Not provided";
}

function getHistorySnippet(item: HubspotWorkspaceHistoryItem): string {
  if (item.kind === "import") {
    switch (item.summary.status) {
      case "queued":
        return "CSV generation is queued and refreshing automatically.";
      case "running":
        return "The import-ready CSV is generating in the background.";
      case "completed":
        return `${item.summary.preparedRowCount} prepared · ${item.summary.failedRowCount} failed.`;
      case "failed":
        return item.summary.lastError
          ? `Failed: ${item.summary.lastError}`
          : "Failed before the worker completed.";
      default:
        return item.summary.status;
    }
  }

  switch (item.summary.status) {
    case "queued":
      return "Legacy push is queued and refreshing automatically.";
    case "running":
      return "Legacy push is running in the background.";
    case "completed":
      return `${item.summary.pushedRowCount} pushed · ${item.summary.failedRowCount} failed.`;
    case "failed":
      return item.summary.lastError
        ? `Failed: ${item.summary.lastError}`
        : "Failed before the worker completed.";
    default:
      return item.summary.status;
  }
}

function getImportRowResultCopy(row: HubspotImportBatchRow): string {
  switch (row.status) {
    case "prepared":
      return "Included in the generated import CSV.";
    case "failed":
      return row.errorMessage ?? "HubSpot import preparation failed.";
    case "pending":
      return "Waiting for the worker to prepare this row.";
    default:
      return row.status;
  }
}

function getLegacyRowResultCopy(row: HubspotPushBatchRow): string {
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
  if (
    (error instanceof HubspotImportBatchesApiError || error instanceof HubspotPushBatchesApiError) &&
    (error.status === 401 || error.status === 403)
  ) {
    return "Your session does not allow HubSpot workspace review anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to load HubSpot history. Please try again.");
}

function getDetailErrorMessage(error: unknown): string {
  if (
    (error instanceof HubspotImportBatchesApiError || error instanceof HubspotPushBatchesApiError) &&
    (error.status === 401 || error.status === 403)
  ) {
    return "Your session does not allow HubSpot batch review anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to load HubSpot batch details. Please try again.");
}

export function formatHubspotPushStatusLabel(
  status:
    | HubspotImportBatchStatus
    | HubspotPushBatchStatus
    | HubspotImportBatchRowStatus
    | HubspotPushBatchRowStatus,
): string {
  return toTitleCase(status);
}

export function shouldPollHubspotPushHistory(
  items: readonly Pick<HubspotWorkspaceHistoryItem, "summary">[],
): boolean {
  return items.some((item) => ACTIVE_POLLING_STATUSES.has(item.summary.status));
}

export function shouldPollHubspotPushDetail(batch: HubspotWorkspaceDetail | null): boolean {
  if (!batch) {
    return false;
  }

  return ACTIVE_POLLING_STATUSES.has(batch.batch.status);
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
  items: readonly HubspotWorkspaceHistoryItem[],
): string | null {
  if (items.length === 0) {
    return null;
  }

  if (requestedBatchId && items.some((item) => getHistoryItemId(item) === requestedBatchId)) {
    return requestedBatchId;
  }

  return getHistoryItemId(items[0]!);
}

function resolveSelectedHistoryItem(
  requestedBatchId: string | null,
  items: readonly HubspotWorkspaceHistoryItem[],
): HubspotWorkspaceHistoryItem | null {
  if (!requestedBatchId) {
    return null;
  }

  return items.find((item) => getHistoryItemId(item) === requestedBatchId) ?? null;
}

function renderHistoryState(props: HubspotPushManagerViewProps): ReactElement {
  const { historyState, selectedBatchId, isRefreshingHistory, onRetryHistory, onSelectBatch } = props;

  if (historyState.status === "loading" && historyState.items.length === 0) {
    return (
      <div className="hubspot-push__feedback hubspot-push__feedback--loading" role="status">
        <p>Loading HubSpot import history...</p>
      </div>
    );
  }

  if (historyState.status === "error" && historyState.items.length === 0) {
    return (
      <div className="hubspot-push__feedback hubspot-push__feedback--error" role="alert">
        <p>{historyState.error ?? "Unable to load HubSpot history."}</p>
        <button className="hubspot-push__button" onClick={onRetryHistory} type="button">
          Retry history
        </button>
      </div>
    );
  }

  if (historyState.items.length === 0) {
    return (
      <div className="hubspot-push__empty-state">
        <h3>No HubSpot import history yet</h3>
        <p>Start a HubSpot import batch from Dashboard or Database to review it here.</p>
        <Link className="hubspot-push__link" href={props.catalogHref}>
          Open Database
        </Link>
      </div>
    );
  }

  return (
    <div className="hubspot-push__history-stack">
      {isRefreshingHistory ? (
        <p className="hubspot-push__inline-note" role="status">
          Refreshing HubSpot history...
        </p>
      ) : null}

      {historyState.error ? (
        <p className="hubspot-push__history-error" role="alert">
          Last refresh failed: {historyState.error}
        </p>
      ) : null}

      <ul className="hubspot-push__list">
        {historyState.items.map((item) => {
          const isSelected = getHistoryItemId(item) === selectedBatchId;

          return (
            <li key={getHistoryItemId(item)}>
              <button
                className={`hubspot-push__list-item${isSelected ? " hubspot-push__list-item--selected" : ""}`}
                onClick={() => {
                  onSelectBatch(getHistoryItemId(item));
                }}
                type="button"
              >
                <div className="hubspot-push__list-item-header">
                  <div>
                    <p className="hubspot-push__eyebrow">
                      {item.kind === "import" ? "Import batch" : "Legacy Week 6 push"}
                    </p>
                    <h3>{getRequestedByLabel(item.summary)}</h3>
                    <p className="hubspot-push__panel-copy">
                      Created {formatTimestamp(item.summary.createdAt)}
                    </p>
                  </div>
                  <span className={`hubspot-push__status hubspot-push__status--${item.summary.status}`}>
                    {formatHubspotPushStatusLabel(item.summary.status)}
                  </span>
                </div>

                <p className="hubspot-push__list-copy">{getHistorySnippet(item)}</p>

                <dl className="hubspot-push__details">
                  {item.kind === "import" ? (
                    <>
                      <div>
                        <dt>Run</dt>
                        <dd>{item.summary.run.name}</dd>
                      </div>
                      <div>
                        <dt>Total</dt>
                        <dd>{item.summary.totalRowCount}</dd>
                      </div>
                      <div>
                        <dt>Prepared</dt>
                        <dd>{item.summary.preparedRowCount}</dd>
                      </div>
                      <div>
                        <dt>Failed</dt>
                        <dd>{item.summary.failedRowCount}</dd>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <dt>Total</dt>
                        <dd>{item.summary.totalRowCount}</dd>
                      </div>
                      <div>
                        <dt>Pushed</dt>
                        <dd>{item.summary.pushedRowCount}</dd>
                      </div>
                      <div>
                        <dt>Failed</dt>
                        <dd>{item.summary.failedRowCount}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{formatTimestamp(item.summary.updatedAt)}</dd>
                      </div>
                    </>
                  )}
                </dl>

                {item.summary.lastError ? (
                  <p className="hubspot-push__history-error">{item.summary.lastError}</p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function renderImportDetail(batch: HubspotImportBatchDetail, isRefreshingDetail: boolean, error: string | null) {
  return (
    <div className="hubspot-push__detail-stack">
      <header className="hubspot-push__detail-header">
        <div>
          <p className="hubspot-push__eyebrow">Week 7 import batch</p>
          <h2>{batch.run.name}</h2>
          <p className="hubspot-push__detail-meta">
            Requested by {getRequestedByLabel(batch)} · <code>{batch.id}</code>
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

      {error ? (
        <p className="hubspot-push__history-error" role="alert">
          Last refresh failed: {error}
        </p>
      ) : null}

      <div className="hubspot-push__callout">
        <h3>Import-ready CSV</h3>
        <p>
          {batch.preparedRowCount} prepared · {batch.failedRowCount} failed · {batch.totalRowCount} total
        </p>
      </div>

      <dl className="hubspot-push__details">
        <div>
          <dt>Run</dt>
          <dd>{batch.run.name}</dd>
        </div>
        <div>
          <dt>File</dt>
          <dd>{batch.fileName}</dd>
        </div>
        <div>
          <dt>Schema</dt>
          <dd>{batch.schemaVersion}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{formatTimestamp(batch.completedAt)}</dd>
        </div>
      </dl>

      <div className="hubspot-push__detail-actions">
        <a
          className="hubspot-push__button"
          href={getHubspotImportBatchDownloadUrl(batch.id)}
        >
          Download CSV
        </a>
        <Link className="hubspot-push__button hubspot-push__button--secondary" href={getHubspotPushBatchResultHref(batch.id)}>
          Open batch result
        </Link>
      </div>

      {batch.rows.length === 0 ? (
        <div className="hubspot-push__empty-state">
          <h3>No stored rows yet</h3>
          <p>This batch does not have prepared rows yet.</p>
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
                  <td>
                    <div className="hubspot-push__cell-copy">
                      {[row.firstName, row.lastName].filter(Boolean).join(" ")}
                    </div>
                    <div className="hubspot-push__cell-copy">{row.contactEmail}</div>
                  </td>
                  <td>{row.channelTitle}</td>
                  <td>{getImportRowResultCopy(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function renderLegacyDetail(batch: HubspotPushBatchDetail, isRefreshingDetail: boolean, error: string | null) {
  return (
    <div className="hubspot-push__detail-stack">
      <header className="hubspot-push__detail-header">
        <div>
          <p className="hubspot-push__eyebrow">Legacy Week 6 push</p>
          <h2>{getRequestedByLabel(batch)}</h2>
          <p className="hubspot-push__detail-meta">
            Stored push result · <code>{batch.id}</code>
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

      {error ? (
        <p className="hubspot-push__history-error" role="alert">
          Last refresh failed: {error}
        </p>
      ) : null}

      <div className="hubspot-push__callout">
        <h3>Legacy detail</h3>
        <p>
          This batch was created by the Week 6 direct-push workflow and remains available for
          read-only review.
        </p>
      </div>

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
          <dt>Completed</dt>
          <dd>{formatTimestamp(batch.completedAt)}</dd>
        </div>
      </dl>

      {batch.rows.length === 0 ? (
        <div className="hubspot-push__empty-state">
          <h3>No stored rows</h3>
          <p>This legacy push has no stored row results yet.</p>
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
                  <td>{row.channelId}</td>
                  <td>{getLegacyRowResultCopy(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function renderDetailState(props: HubspotPushManagerViewProps): ReactElement {
  const { detailState, isRefreshingDetail, onRetryDetail } = props;

  if (detailState.requestState === "idle") {
    return (
      <div className="hubspot-push__empty-state">
        <h2>Select a HubSpot batch</h2>
        <p>Pick a Week 7 import batch or a legacy push record to inspect its saved row outcomes.</p>
      </div>
    );
  }

  if (detailState.requestState === "loading" && !detailState.data) {
    return (
      <div className="hubspot-push__feedback hubspot-push__feedback--loading" role="status">
        <p>Loading HubSpot batch details...</p>
      </div>
    );
  }

  if (detailState.requestState === "error" && !detailState.data) {
    return (
      <div className="hubspot-push__feedback hubspot-push__feedback--error" role="alert">
        <p>{detailState.error ?? "Unable to load HubSpot batch details."}</p>
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

  if (!detailState.data) {
    return (
      <div className="hubspot-push__feedback hubspot-push__feedback--error" role="alert">
        <p>Unable to load HubSpot batch details.</p>
      </div>
    );
  }

  return detailState.data.kind === "import"
    ? renderImportDetail(detailState.data.batch, isRefreshingDetail, detailState.error)
    : renderLegacyDetail(detailState.data.batch, isRefreshingDetail, detailState.error);
}

export function HubspotPushManagerView(props: HubspotPushManagerViewProps) {
  const { catalogHref, onReloadHistory } = props;

  return (
    <div className="hubspot-push">
      <div className="hubspot-push__toolbar">
        <div className="hubspot-push__toolbar-copy">
          <p className="hubspot-push__eyebrow">Week 7 workspace</p>
          <h2>HubSpot import batches</h2>
          <p className="hubspot-push__panel-copy">
            Review run-scoped import-ready CSV batches and keep legacy Week 6 pushes readable in
            the same workspace.
          </p>
        </div>
        <div className="hubspot-push__toolbar-actions">
          <Link className="hubspot-push__link" href={catalogHref}>
            Open Database
          </Link>
          <button
            className="hubspot-push__button hubspot-push__button--secondary"
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
            <h2 id="hubspot-push-history-heading">Recent history</h2>
            <p>Week 7 import batches appear first; legacy Week 6 pushes remain read-only.</p>
          </header>
          {renderHistoryState(props)}
        </section>

        <section className="hubspot-push__panel" aria-labelledby="hubspot-push-detail-heading">
          <header className="hubspot-push__panel-header">
            <h2 id="hubspot-push-detail-heading">Batch detail</h2>
            <p>Inspect stored row outcomes, failures, and generated artifacts for the selected batch.</p>
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
  const [historyState, setHistoryState] = useState<HubspotPushHistoryState>(INITIAL_HISTORY_STATE);
  const [detailState, setDetailState] = useState<HubspotPushDetailState>(INITIAL_DETAIL_STATE);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [historyReloadToken, setHistoryReloadToken] = useState(0);
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
  const [isRefreshingDetail, setIsRefreshingDetail] = useState(false);

  useEffect(() => {
    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function loadHistory(polling = false): Promise<void> {
      if (polling) {
        setIsRefreshingHistory(true);
      } else {
        setHistoryState((current) =>
          current.items.length === 0 ? INITIAL_HISTORY_STATE : { ...current, error: null },
        );
      }

      try {
        const [importsResult, legacyResult] = await Promise.allSettled([
          fetchHubspotImportBatches(abortController.signal),
          fetchHubspotPushBatches(abortController.signal),
        ]);

        if (didCancel || abortController.signal.aborted) {
          return;
        }

        const items: HubspotWorkspaceHistoryItem[] = [];
        const errors: string[] = [];

        if (importsResult.status === "fulfilled") {
          items.push(
            ...importsResult.value.map((summary) => ({
              kind: "import" as const,
              summary,
            })),
          );
        } else {
          errors.push(getHistoryErrorMessage(importsResult.reason));
        }

        if (legacyResult.status === "fulfilled") {
          items.push(
            ...legacyResult.value.map((summary) => ({
              kind: "legacy" as const,
              summary,
            })),
          );
        } else {
          errors.push(getHistoryErrorMessage(legacyResult.reason));
        }

        items.sort(
          (left, right) =>
            Date.parse(right.summary.createdAt) - Date.parse(left.summary.createdAt),
        );

        if (items.length === 0 && errors.length > 0) {
          setHistoryState({
            status: "error",
            items: [],
            error: errors[0] ?? "Unable to load HubSpot history.",
          });
          return;
        }

        setHistoryState({
          status: "ready",
          items,
          error: errors.length > 0 ? errors.join(" ") : null,
        });

        if (shouldPollHubspotPushHistory(items)) {
          timeoutId = setTimeout(() => {
            void loadHistory(true);
          }, HUBSPOT_PUSH_HISTORY_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setHistoryState({
          status: "error",
          items: [],
          error: getHistoryErrorMessage(error),
        });
      } finally {
        if (!didCancel && !abortController.signal.aborted) {
          setIsRefreshingHistory(false);
        }
      }
    }

    void loadHistory();

    return () => {
      didCancel = true;
      abortController.abort();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [historyReloadToken]);

  useEffect(() => {
    if (historyState.status !== "ready") {
      return;
    }

    const requestedBatchId = searchParams.get("batchId");
    const resolvedBatchId = resolveSelectedBatchId(requestedBatchId, historyState.items);

    setSelectedBatchId(resolvedBatchId);

    if (resolvedBatchId !== requestedBatchId) {
      router.replace(buildHubspotPushWorkspaceHref(pathname, resolvedBatchId));
    }
  }, [historyState, pathname, router, searchParams]);

  useEffect(() => {
    const selectedItem = resolveSelectedHistoryItem(selectedBatchId, historyState.items);

    if (!selectedItem) {
      setDetailState(INITIAL_DETAIL_STATE);
      return;
    }

    const targetItem = selectedItem;

    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function loadDetail(polling = false): Promise<void> {
      if (polling) {
        setIsRefreshingDetail(true);
      } else {
        setDetailState((current) =>
          current.data ? { ...current, error: null } : { requestState: "loading", data: null, error: null },
        );
      }

      try {
        const data =
          targetItem.kind === "import"
            ? ({
                kind: "import" as const,
                batch: await fetchHubspotImportBatchDetail(targetItem.summary.id, abortController.signal),
              })
            : ({
                kind: "legacy" as const,
                batch: await fetchHubspotPushBatchDetail(targetItem.summary.id, abortController.signal),
              });

        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setDetailState({
          requestState: "ready",
          data,
          error: null,
        });

        if (shouldPollHubspotPushDetail(data)) {
          timeoutId = setTimeout(() => {
            void loadDetail(true);
          }, HUBSPOT_PUSH_HISTORY_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (didCancel || abortController.signal.aborted) {
          return;
        }

        const errorMessage = getDetailErrorMessage(error);

        setDetailState((current) =>
          current.data
            ? {
                requestState: "ready",
                data: current.data,
                error: errorMessage,
              }
            : {
                requestState: "error",
                data: null,
                error: errorMessage,
              },
        );
      } finally {
        if (!didCancel && !abortController.signal.aborted) {
          setIsRefreshingDetail(false);
        }
      }
    }

    void loadDetail();

    return () => {
      didCancel = true;
      abortController.abort();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [detailReloadToken, historyState.items, selectedBatchId]);

  return (
    <HubspotPushManagerView
      catalogHref="/database?tab=runs"
      detailState={detailState}
      historyState={historyState}
      isRefreshingDetail={isRefreshingDetail}
      isRefreshingHistory={isRefreshingHistory}
      onReloadHistory={() => {
        setHistoryReloadToken((current) => current + 1);
      }}
      onRetryDetail={() => {
        setDetailReloadToken((current) => current + 1);
      }}
      onRetryHistory={() => {
        setHistoryReloadToken((current) => current + 1);
      }}
      onSelectBatch={(batchId) => {
        setSelectedBatchId(batchId);
        router.replace(buildHubspotPushWorkspaceHref(pathname, batchId));
      }}
      selectedBatchId={selectedBatchId}
    />
  );
}
