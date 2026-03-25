"use client";

import type {
  HubspotImportBatchDetail,
  HubspotImportBatchRowStatus,
  HubspotImportBatchStatus,
  HubspotPushBatchDetail,
  HubspotPushBatchRowStatus,
  HubspotPushBatchStatus,
} from "@scouting-platform/contracts";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import {
  fetchHubspotImportBatchDetail,
  getHubspotImportBatchDownloadUrl,
  HubspotImportBatchesApiError,
} from "../../lib/hubspot-import-batches-api";
import {
  fetchHubspotPushBatchDetail,
  HubspotPushBatchesApiError,
} from "../../lib/hubspot-push-batches-api";

type HubspotPushBatchResultShellProps = Readonly<{
  batchId: string;
}>;

type HubspotBatchDetail =
  | { kind: "import"; batch: HubspotImportBatchDetail }
  | { kind: "legacy"; batch: HubspotPushBatchDetail };

type HubspotPushBatchResultRequestState = {
  requestState: "loading" | "error" | "notFound" | "ready";
  data: HubspotBatchDetail | null;
  error: string | null;
};

type HubspotPushBatchResultShellViewProps = HubspotPushBatchResultShellProps & {
  isRefreshing: boolean;
  onRetry: () => void;
  requestState: HubspotPushBatchResultRequestState;
};

const INITIAL_REQUEST_STATE: HubspotPushBatchResultRequestState = {
  requestState: "loading",
  data: null,
  error: null,
};

const NOT_FOUND_REQUEST_STATE: HubspotPushBatchResultRequestState = {
  requestState: "notFound",
  data: null,
  error: null,
};

const ACTIVE_POLLING_STATUSES = new Set<HubspotImportBatchStatus | HubspotPushBatchStatus>([
  "queued",
  "running",
]);

export const HUBSPOT_PUSH_BATCH_RESULT_POLL_INTERVAL_MS = 3000;

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

function getRequestedByLabel(
  batch: Pick<HubspotImportBatchDetail, "requestedBy"> | Pick<HubspotPushBatchDetail, "requestedBy">,
): string {
  return batch.requestedBy.name?.trim() || batch.requestedBy.email;
}

function getImportRowResultCopy(row: HubspotImportBatchDetail["rows"][number]): string {
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

function getLegacyRowResultCopy(row: HubspotPushBatchDetail["rows"][number]): string {
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

function getImportBatchStatusSummary(batch: HubspotImportBatchDetail): string {
  switch (batch.status) {
    case "queued":
      return "The import-ready CSV is queued. This screen refreshes automatically while the worker picks it up.";
    case "running":
      return "The worker is preparing the import-ready CSV in the background. Keep this screen open while progress refreshes automatically.";
    case "completed":
      return "The import-ready CSV completed and the stored per-row outcomes are ready for review.";
    case "failed":
      return batch.lastError
        ? `The worker failed before finishing the CSV. ${batch.lastError}`
        : "The worker failed before finishing the CSV.";
    default:
      return batch.status;
  }
}

function getLegacyBatchStatusSummary(batch: HubspotPushBatchDetail): string {
  switch (batch.status) {
    case "queued":
      return "This legacy Week 6 push is still queued.";
    case "running":
      return "This legacy Week 6 push is still running.";
    case "completed":
      return "The legacy direct push completed and the stored row outcomes are ready for review.";
    case "failed":
      return batch.lastError
        ? `The legacy push failed before finishing. ${batch.lastError}`
        : "The legacy push failed before finishing.";
    default:
      return batch.status;
  }
}

function buildHubspotPushWorkspaceHref(batchId: string): string {
  return `/hubspot?batchId=${encodeURIComponent(batchId)}`;
}

export function formatHubspotPushBatchResultStatusLabel(
  status:
    | HubspotImportBatchStatus
    | HubspotPushBatchStatus
    | HubspotImportBatchRowStatus
    | HubspotPushBatchRowStatus,
): string {
  return toTitleCase(status);
}

export function shouldPollHubspotPushBatchResult(batch: HubspotBatchDetail | null): boolean {
  if (!batch) {
    return false;
  }

  return ACTIVE_POLLING_STATUSES.has(batch.batch.status);
}

export function getHubspotPushBatchDetailRequestErrorMessage(error: unknown): string {
  if (
    (error instanceof HubspotImportBatchesApiError || error instanceof HubspotPushBatchesApiError) &&
    (error.status === 401 || error.status === 403)
  ) {
    return "Your session does not allow access to this HubSpot batch anymore. Sign in again and retry.";
  }

  if (error instanceof HubspotImportBatchesApiError || error instanceof HubspotPushBatchesApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to load HubSpot batch details. Please try again.";
}

function renderImportResult(batch: HubspotImportBatchDetail) {
  return (
    <>
      <div className="hubspot-push__callout">
        <h3>Batch summary</h3>
        <p>
          {batch.preparedRowCount} prepared · {batch.failedRowCount} failed · {batch.totalRowCount} total
        </p>
      </div>

      <dl className="hubspot-push__details">
        <div>
          <dt>Requested by</dt>
          <dd>{getRequestedByLabel(batch)}</dd>
        </div>
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
          <dt>Created</dt>
          <dd>{formatTimestamp(batch.createdAt)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatTimestamp(batch.startedAt)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatTimestamp(batch.updatedAt)}</dd>
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

      <div className="hubspot-push__detail-actions">
        <a className="hubspot-push__button" href={getHubspotImportBatchDownloadUrl(batch.id)}>
          Download CSV
        </a>
        <Link
          className="hubspot-push__button hubspot-push__button--secondary"
          href={buildHubspotPushWorkspaceHref(batch.id)}
        >
          Open workspace view
        </Link>
      </div>

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
                      {formatHubspotPushBatchResultStatusLabel(row.status)}
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
    </>
  );
}

function renderLegacyResult(batch: HubspotPushBatchDetail) {
  return (
    <>
      <div className="hubspot-push__callout">
        <h3>Legacy Week 6 push</h3>
        <p>
          This result came from the older direct-push workflow and remains available here as
          read-only history.
        </p>
      </div>

      <dl className="hubspot-push__details">
        <div>
          <dt>Requested by</dt>
          <dd>{getRequestedByLabel(batch)}</dd>
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
          <dt>Updated</dt>
          <dd>{formatTimestamp(batch.updatedAt)}</dd>
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

      <details className="hubspot-push__scope-disclosure">
        <summary>View selected channel IDs</summary>
        <ul className="hubspot-push__scope-list">
          {batch.scope.channelIds.map((channelId) => (
            <li key={channelId}>
              <code>{channelId}</code>
            </li>
          ))}
        </ul>
      </details>

      <div className="hubspot-push__detail-actions">
        <Link
          className="hubspot-push__button hubspot-push__button--secondary"
          href={buildHubspotPushWorkspaceHref(batch.id)}
        >
          Open workspace view
        </Link>
        <Link className="hubspot-push__button hubspot-push__button--secondary" href="/catalog">
          Open catalog
        </Link>
      </div>

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
                      {formatHubspotPushBatchResultStatusLabel(row.status)}
                    </span>
                  </td>
                  <td>{row.contactEmail ?? "Not provided"}</td>
                  <td>{row.channelId}</td>
                  <td>{getLegacyRowResultCopy(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function HubspotPushBatchResultShellView({
  batchId,
  isRefreshing,
  onRetry,
  requestState,
}: HubspotPushBatchResultShellViewProps) {
  if (requestState.requestState === "loading" && !requestState.data) {
    return (
      <section className="hubspot-push__feedback hubspot-push__feedback--loading" role="status">
        <p>
          Loading HubSpot batch <code>{batchId}</code>.
        </p>
      </section>
    );
  }

  if (requestState.requestState === "error" && !requestState.data) {
    return (
      <section className="hubspot-push__feedback hubspot-push__feedback--error" role="alert">
        <p>{requestState.error ?? "Unable to load HubSpot batch details."}</p>
        <button className="hubspot-push__button" onClick={onRetry} type="button">
          Retry
        </button>
      </section>
    );
  }

  if (requestState.requestState === "notFound") {
    return (
      <section className="hubspot-push__empty-state" role="status">
        <h2>HubSpot batch not found</h2>
        <p>The requested batch does not exist or is no longer visible to this account.</p>
      </section>
    );
  }

  const detail = requestState.data;

  if (!detail) {
    return (
      <section className="hubspot-push__feedback hubspot-push__feedback--error" role="alert">
        <p>Unable to load HubSpot batch details.</p>
      </section>
    );
  }

  const batch = detail.batch;
  const summary =
    detail.kind === "import"
      ? getImportBatchStatusSummary(detail.batch)
      : getLegacyBatchStatusSummary(detail.batch);
  const title = detail.kind === "import" ? detail.batch.run.name : getRequestedByLabel(detail.batch);

  return (
    <div className="hubspot-push">
      <section className="hubspot-push__panel">
        <header className="hubspot-push__detail-header">
          <div>
            <p className="hubspot-push__eyebrow">
              {detail.kind === "import" ? "Week 7 import batch" : "Legacy Week 6 push"}
            </p>
            <h2>{title}</h2>
            <p className="hubspot-push__panel-copy">{summary}</p>
          </div>
          <span className={`hubspot-push__status hubspot-push__status--${batch.status}`}>
            {formatHubspotPushBatchResultStatusLabel(batch.status)}
          </span>
        </header>

        {isRefreshing ? (
          <p className="hubspot-push__inline-note" role="status">
            Refreshing batch result...
          </p>
        ) : null}

        {requestState.error ? (
          <p className="hubspot-push__history-error" role="alert">
            Last refresh failed: {requestState.error}
          </p>
        ) : null}

        {detail.kind === "import"
          ? renderImportResult(detail.batch)
          : renderLegacyResult(detail.batch)}
      </section>
    </div>
  );
}

export function HubspotPushBatchResultShell({ batchId }: HubspotPushBatchResultShellProps) {
  const [requestState, setRequestState] =
    useState<HubspotPushBatchResultRequestState>(INITIAL_REQUEST_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function loadDetail(polling = false) {
      if (!polling) {
        setRequestState((current) =>
          current.data
            ? { ...current, error: null }
            : {
                requestState: "loading",
                data: null,
                error: null,
              },
        );
      } else {
        setIsRefreshing(true);
      }

      try {
        let detail: HubspotBatchDetail;

        try {
          detail = {
            kind: "import",
            batch: await fetchHubspotImportBatchDetail(batchId, abortController.signal),
          };
        } catch (error) {
          if (error instanceof HubspotImportBatchesApiError && error.status === 404) {
            detail = {
              kind: "legacy",
              batch: await fetchHubspotPushBatchDetail(batchId, abortController.signal),
            };
          } else {
            throw error;
          }
        }

        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setRequestState({
          requestState: "ready",
          data: detail,
          error: null,
        });

        if (shouldPollHubspotPushBatchResult(detail)) {
          timeoutId = setTimeout(() => {
            void loadDetail(true);
          }, HUBSPOT_PUSH_BATCH_RESULT_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (didCancel || abortController.signal.aborted) {
          return;
        }

        if (
          (error instanceof HubspotImportBatchesApiError || error instanceof HubspotPushBatchesApiError) &&
          error.status === 404
        ) {
          setRequestState(NOT_FOUND_REQUEST_STATE);
          return;
        }

        const errorMessage = getHubspotPushBatchDetailRequestErrorMessage(error);

        setRequestState((current) =>
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
          setIsRefreshing(false);
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
  }, [batchId, reloadToken]);

  return (
    <HubspotPushBatchResultShellView
      batchId={batchId}
      isRefreshing={isRefreshing}
      onRetry={() => {
        setReloadToken((current) => current + 1);
      }}
      requestState={requestState}
    />
  );
}
