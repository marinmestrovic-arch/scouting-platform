"use client";

import type { CsvExportBatchDetail, CsvExportBatchStatus } from "@scouting-platform/contracts";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import {
  buildCatalogHref,
  buildSavedSegmentFilters,
  formatSavedSegmentSummary,
  type CatalogFiltersState,
  normalizeCatalogFilters,
} from "../../lib/catalog-filters";
import {
  CsvExportBatchesApiError,
  fetchCsvExportBatchDetail,
  getCsvExportBatchDownloadUrl,
} from "../../lib/csv-export-batches-api";

type CsvExportBatchResultShellProps = Readonly<{
  batchId: string;
}>;

type CsvExportBatchResultRequestState = {
  requestState: "loading" | "error" | "notFound" | "ready";
  data: CsvExportBatchDetail | null;
  error: string | null;
};

type CsvExportBatchResultShellViewProps = CsvExportBatchResultShellProps & {
  isRefreshing: boolean;
  onRetry: () => void;
  requestState: CsvExportBatchResultRequestState;
};

const INITIAL_REQUEST_STATE: CsvExportBatchResultRequestState = {
  requestState: "loading",
  data: null,
  error: null,
};

const NOT_FOUND_REQUEST_STATE: CsvExportBatchResultRequestState = {
  requestState: "notFound",
  data: null,
  error: null,
};

export const CSV_EXPORT_BATCH_RESULT_POLL_INTERVAL_MS = 3000;

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

function getScopeLabel(type: CsvExportBatchDetail["scope"]["type"]): string {
  return type === "filtered" ? "Filtered export" : "Selected export";
}

function getRequestedByLabel(batch: Pick<CsvExportBatchDetail, "requestedBy">): string {
  return batch.requestedBy.name?.trim() || batch.requestedBy.email;
}

function getBatchStatusSummary(batch: CsvExportBatchDetail): string {
  switch (batch.status) {
    case "queued":
      return "The export is queued. This screen refreshes automatically while the worker picks it up.";
    case "running":
      return "The worker is generating the CSV artifact in the background. Keep this screen open while progress refreshes automatically.";
    case "completed":
      return "The export completed and the stored CSV artifact is ready for download.";
    case "failed":
      return batch.lastError
        ? `The worker failed before finishing the CSV artifact. ${batch.lastError}`
        : "The worker failed before finishing the CSV artifact.";
    default:
      return batch.status;
  }
}

function formatSelectedChannelCount(count: number): string {
  return `${count} channel${count === 1 ? "" : "s"}`;
}

function formatFilterValue(values: readonly string[]): string {
  if (values.length === 0) {
    return "Any";
  }

  return values.join(", ");
}

function formatRangeFilter(min: string, max: string): string {
  if (min && max) {
    return `${min}-${max}`;
  }

  if (min) {
    return `>= ${min}`;
  }

  if (max) {
    return `<= ${max}`;
  }

  return "Any";
}

function getNormalizedScopeFilters(
  filters: Extract<CsvExportBatchDetail["scope"], { type: "filtered" }>["filters"],
): CatalogFiltersState {
  return normalizeCatalogFilters({
    ...(filters.query ? { query: filters.query } : {}),
    ...(filters.countryRegion ? { countryRegion: filters.countryRegion } : {}),
    ...(filters.influencerVertical ? { influencerVertical: filters.influencerVertical } : {}),
    ...(filters.influencerType ? { influencerType: filters.influencerType } : {}),
    ...(filters.youtubeVideoMedianViewsMin !== undefined
      ? { youtubeVideoMedianViewsMin: filters.youtubeVideoMedianViewsMin }
      : {}),
    ...(filters.youtubeVideoMedianViewsMax !== undefined
      ? { youtubeVideoMedianViewsMax: filters.youtubeVideoMedianViewsMax }
      : {}),
    ...(filters.youtubeShortsMedianViewsMin !== undefined
      ? { youtubeShortsMedianViewsMin: filters.youtubeShortsMedianViewsMin }
      : {}),
    ...(filters.youtubeShortsMedianViewsMax !== undefined
      ? { youtubeShortsMedianViewsMax: filters.youtubeShortsMedianViewsMax }
      : {}),
    ...(filters.youtubeFollowersMin !== undefined
      ? { youtubeFollowersMin: filters.youtubeFollowersMin }
      : {}),
    ...(filters.youtubeFollowersMax !== undefined
      ? { youtubeFollowersMax: filters.youtubeFollowersMax }
      : {}),
    ...(filters.enrichmentStatus ? { enrichmentStatus: filters.enrichmentStatus } : {}),
    ...(filters.advancedReportStatus
      ? { advancedReportStatus: filters.advancedReportStatus }
      : {}),
  });
}

function getScopeCatalogHref(batch: CsvExportBatchDetail): string {
  if (batch.scope.type === "selected") {
    return "/catalog";
  }

  return buildCatalogHref("/catalog", {
    page: 1,
    filters: getNormalizedScopeFilters(batch.scope.filters),
  });
}

function renderScopeState(batch: CsvExportBatchDetail) {
  if (batch.scope.type === "selected") {
    return (
      <>
        <div className="csv-export__callout">
          <h3>Selected scope snapshot</h3>
          <p>{formatSelectedChannelCount(batch.scope.channelIds.length)} were captured when this batch was created.</p>
        </div>

        <details className="csv-export__scope-disclosure">
          <summary>View selected channel IDs</summary>
          <ul className="csv-export__scope-list">
            {batch.scope.channelIds.map((channelId) => (
              <li key={channelId}>
                <code>{channelId}</code>
              </li>
            ))}
          </ul>
        </details>
      </>
    );
  }

  const normalizedFilters = getNormalizedScopeFilters(batch.scope.filters);

  return (
    <>
      <div className="csv-export__callout">
        <h3>Filtered scope snapshot</h3>
        <p>{formatSavedSegmentSummary(buildSavedSegmentFilters(normalizedFilters))}</p>
      </div>

      <dl className="csv-export__details">
        <div>
          <dt>Search</dt>
          <dd>{normalizedFilters.query || "Any"}</dd>
        </div>
        <div>
          <dt>Country/Region</dt>
          <dd>{formatFilterValue(normalizedFilters.countryRegion)}</dd>
        </div>
        <div>
          <dt>Influencer Vertical</dt>
          <dd>{formatFilterValue(normalizedFilters.influencerVertical)}</dd>
        </div>
        <div>
          <dt>Influencer Type</dt>
          <dd>{formatFilterValue(normalizedFilters.influencerType)}</dd>
        </div>
        <div>
          <dt>Video Median Views</dt>
          <dd>
            {formatRangeFilter(
              normalizedFilters.youtubeVideoMedianViewsMin,
              normalizedFilters.youtubeVideoMedianViewsMax,
            )}
          </dd>
        </div>
        <div>
          <dt>Shorts Median Views</dt>
          <dd>
            {formatRangeFilter(
              normalizedFilters.youtubeShortsMedianViewsMin,
              normalizedFilters.youtubeShortsMedianViewsMax,
            )}
          </dd>
        </div>
        <div>
          <dt>YouTube Followers</dt>
          <dd>
            {formatRangeFilter(
              normalizedFilters.youtubeFollowersMin,
              normalizedFilters.youtubeFollowersMax,
            )}
          </dd>
        </div>
      </dl>
    </>
  );
}

export function formatCsvExportBatchStatusLabel(status: CsvExportBatchStatus): string {
  return toTitleCase(status);
}

export function shouldPollCsvExportBatchResult(
  batch: Pick<CsvExportBatchDetail, "status"> | null,
): boolean {
  if (!batch) {
    return false;
  }

  return batch.status === "queued" || batch.status === "running";
}

export function getCsvExportBatchDetailRequestErrorMessage(error: unknown): string {
  if (error instanceof CsvExportBatchesApiError) {
    if (error.status === 401 || error.status === 403) {
      return "Your session does not allow access to this CSV export batch anymore. Sign in again and retry.";
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to load CSV export batch details. Please try again.";
}

export function CsvExportBatchResultShellView({
  batchId,
  isRefreshing,
  onRetry,
  requestState,
}: CsvExportBatchResultShellViewProps) {
  if (requestState.requestState === "loading" && !requestState.data) {
    return (
      <section className="csv-export__feedback csv-export__feedback--loading" role="status">
        <p>
          Loading CSV export batch <code>{batchId}</code>.
        </p>
      </section>
    );
  }

  if (requestState.requestState === "error" && !requestState.data) {
    return (
      <section className="csv-export__feedback csv-export__feedback--error" role="alert">
        <p>{requestState.error ?? "Unable to load CSV export batch details."}</p>
        <button className="csv-export__button" onClick={onRetry} type="button">
          Retry
        </button>
      </section>
    );
  }

  if (requestState.requestState === "notFound") {
    return (
      <section className="csv-export__empty-state" role="status">
        <h2>CSV export batch not found</h2>
        <p>The requested batch does not exist or is no longer visible to this account.</p>
      </section>
    );
  }

  const batch = requestState.data;

  if (!batch) {
    return (
      <section className="csv-export__feedback csv-export__feedback--error" role="alert">
        <p>Unable to load CSV export batch details.</p>
      </section>
    );
  }

  const catalogHref = getScopeCatalogHref(batch);

  return (
    <div className="csv-export">
      <section className="csv-export__panel">
        <header className="csv-export__detail-header">
          <div>
            <p className="csv-export__eyebrow">Batch result</p>
            <h2>{batch.fileName}</h2>
            <p className="csv-export__panel-copy">{getBatchStatusSummary(batch)}</p>
          </div>
          <span className={`csv-export__status csv-export__status--${batch.status}`}>
            {formatCsvExportBatchStatusLabel(batch.status)}
          </span>
        </header>

        {isRefreshing ? (
          <p className="csv-export__inline-note" role="status">
            Refreshing batch result...
          </p>
        ) : null}

        {requestState.error ? (
          <p className="csv-export__history-error" role="alert">
            Last refresh failed: {requestState.error}
          </p>
        ) : null}

        <div className="csv-export__callout">
          <h3>Batch summary</h3>
          <p>
            {getScopeLabel(batch.scope.type)} · {batch.rowCount} rows · schema {batch.schemaVersion}
          </p>
        </div>

        <dl className="csv-export__details">
          <div>
            <dt>Requested by</dt>
            <dd>{getRequestedByLabel(batch)}</dd>
          </div>
          <div>
            <dt>Batch ID</dt>
            <dd>
              <code>{batch.id}</code>
            </dd>
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

        <div className="csv-export__actions">
          {batch.status === "completed" ? (
            <a
              className="csv-export__button"
              download
              href={getCsvExportBatchDownloadUrl(batch.id)}
            >
              Download CSV
            </a>
          ) : null}

          <Link className="csv-export__button csv-export__button--secondary" href="/exports">
            Back to exports workspace
          </Link>
          <Link className="csv-export__button csv-export__button--secondary" href={catalogHref}>
            Open catalog
          </Link>
        </div>
      </section>

      <section className="csv-export__panel">
        <header className="csv-export__panel-header">
          <h2>Stored scope</h2>
          <p>Review the exact scope snapshot that was saved when this export batch was requested.</p>
        </header>

        {renderScopeState(batch)}
      </section>
    </div>
  );
}

export function CsvExportBatchResultShell({ batchId }: CsvExportBatchResultShellProps) {
  const [requestState, setRequestState] =
    useState<CsvExportBatchResultRequestState>(INITIAL_REQUEST_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    const keepCurrentDetailVisible =
      requestState.requestState === "ready" && requestState.data?.id === batchId;

    if (!keepCurrentDetailVisible) {
      setRequestState(INITIAL_REQUEST_STATE);
    } else {
      setIsRefreshing(true);
    }

    void fetchCsvExportBatchDetail(batchId, abortController.signal)
      .then((detail) => {
        if (abortController.signal.aborted) {
          return;
        }

        setRequestState({
          requestState: "ready",
          data: detail,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        if (error instanceof CsvExportBatchesApiError && error.status === 404) {
          setRequestState(NOT_FOUND_REQUEST_STATE);
          return;
        }

        const message = getCsvExportBatchDetailRequestErrorMessage(error);

        setRequestState((current) => {
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
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsRefreshing(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [batchId, reloadToken]);

  useEffect(() => {
    if (
      requestState.requestState !== "ready" ||
      isRefreshing ||
      !shouldPollCsvExportBatchResult(requestState.data)
    ) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setReloadToken((current) => current + 1);
    }, CSV_EXPORT_BATCH_RESULT_POLL_INTERVAL_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isRefreshing, requestState]);

  function handleRetry() {
    setReloadToken((current) => current + 1);
  }

  return (
    <CsvExportBatchResultShellView
      batchId={batchId}
      isRefreshing={isRefreshing}
      onRetry={handleRetry}
      requestState={requestState}
    />
  );
}
