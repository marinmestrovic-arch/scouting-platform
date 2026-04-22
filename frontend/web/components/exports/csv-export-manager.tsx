"use client";

import type {
  CsvExportBatchStatus,
  CsvExportBatchSummary,
  CsvExportScopeType,
} from "@scouting-platform/contracts";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";

import {
  buildCatalogChannelFilters,
  buildCatalogFilterHref,
  buildCatalogFilterSearchParams,
  buildCatalogHref,
  DEFAULT_CATALOG_FILTERS,
  hasActiveCatalogFilters,
  normalizeCatalogNumericFilterValue,
  parseCatalogFiltersFromSearchParams,
  type CatalogFiltersState,
  type CatalogMultiValueFilterKey,
  type CatalogNumericFilterKey,
} from "../../lib/catalog-filters";
import {
  CsvExportBatchesApiError,
  createCsvExportBatch,
  fetchCsvExportBatches,
  getCsvExportBatchDownloadUrl,
} from "../../lib/csv-export-batches-api";
import { getCsvExportBatchResultHref } from "../../lib/navigation";

type CsvExportHistoryState = {
  status: "loading" | "error" | "ready";
  items: CsvExportBatchSummary[];
  error: string | null;
};

type CsvExportCreateState = {
  type: "idle" | "submitting" | "success" | "error";
  message: string;
};

type CsvExportManagerViewProps = Readonly<{
  filters: CatalogFiltersState;
  historyState: CsvExportHistoryState;
  createState: CsvExportCreateState;
  hasActiveFilters: boolean;
  isRefreshing: boolean;
  catalogHref: string;
  onMultiValueFilterTextChange: (key: CatalogMultiValueFilterKey, value: string) => void;
  onNumericFilterChange: (key: CatalogNumericFilterKey, value: string) => void;
  onQueryChange: (value: string) => void;
  onResetFilters: () => void;
  onCreateFilteredExport: () => void | Promise<void>;
  onReloadHistory: () => void;
  onRetryHistory: () => void;
}>;

const INITIAL_HISTORY_STATE: CsvExportHistoryState = {
  status: "loading",
  items: [],
  error: null,
};

const IDLE_CREATE_STATE: CsvExportCreateState = {
  type: "idle",
  message: "",
};

export const CSV_EXPORT_HISTORY_POLL_INTERVAL_MS = 3000;

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

function getScopeLabel(scopeType: CsvExportScopeType): string {
  return scopeType === "filtered" ? "Filtered export" : "Selected export";
}

function getHistorySnippet(batch: CsvExportBatchSummary): string {
  switch (batch.status) {
    case "queued":
      return "Queued and refreshing automatically.";
    case "running":
      return "Running in the background and refreshing automatically.";
    case "completed":
      return "Completed and ready for download.";
    case "failed":
      return batch.lastError
        ? `Failed: ${batch.lastError}`
        : "Failed before the worker completed.";
    default:
      return batch.status;
  }
}

function getCreateErrorMessage(error: unknown): string {
  if (error instanceof CsvExportBatchesApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow CSV export creation anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to create the CSV export. Please try again.");
}

function getHistoryErrorMessage(error: unknown): string {
  if (error instanceof CsvExportBatchesApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow CSV export history review anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to load CSV export history. Please try again.");
}

function getCreateSuccessMessage(batch: CsvExportBatchSummary): string {
  if (batch.status === "completed") {
    return "Filtered CSV export is ready. Download it from the history below.";
  }

  if (batch.status === "failed") {
    return "Filtered CSV export failed immediately. Review the latest history entry for details.";
  }

  return "Filtered CSV export queued. History refreshes automatically while processing continues.";
}

function upsertCsvExportBatch(
  items: readonly CsvExportBatchSummary[],
  batch: CsvExportBatchSummary,
): CsvExportBatchSummary[] {
  return [batch, ...items.filter((item) => item.id !== batch.id)];
}

export function formatCsvExportBatchStatusLabel(status: CsvExportBatchStatus): string {
  return toTitleCase(status);
}

export function shouldPollCsvExportBatches(
  items: readonly Pick<CsvExportBatchSummary, "status">[],
): boolean {
  return items.some((item) => item.status === "queued" || item.status === "running");
}

function parseMultiValueText(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function formatMultiValueText(values: readonly string[]): string {
  return values.join(", ");
}

function renderHistoryState(props: CsvExportManagerViewProps): ReactElement {
  const { historyState, isRefreshing, onRetryHistory } = props;

  if (historyState.status === "loading" && historyState.items.length === 0) {
    return (
      <div className="csv-export__feedback csv-export__feedback--loading" role="status">
        <p>Loading CSV export history...</p>
      </div>
    );
  }

  if (historyState.status === "error" && historyState.items.length === 0) {
    return (
      <div className="csv-export__feedback csv-export__feedback--error" role="alert">
        <p>{historyState.error ?? "Unable to load CSV export history."}</p>
        <button className="csv-export__button" onClick={onRetryHistory} type="button">
          Retry history
        </button>
      </div>
    );
  }

  if (historyState.items.length === 0) {
    return (
      <div className="csv-export__empty-state">
        <h3>No export history yet</h3>
        <p>Create the first filtered CSV export here, or use the catalog to start a selected export batch.</p>
      </div>
    );
  }

  return (
    <div className="csv-export__history-stack">
      {isRefreshing ? (
        <p className="csv-export__inline-note" role="status">
          Refreshing export history...
        </p>
      ) : null}

      {historyState.error ? (
        <p className="csv-export__history-error" role="alert">
          Last refresh failed: {historyState.error}
        </p>
      ) : null}

      <ul className="csv-export__list">
        {historyState.items.map((batch) => (
          <li className="csv-export__list-item" key={batch.id}>
            <div className="csv-export__list-item-header">
              <div>
                <p className="csv-export__eyebrow">{getScopeLabel(batch.scopeType)}</p>
                <h3>{batch.fileName}</h3>
              </div>
              <span className={`csv-export__status csv-export__status--${batch.status}`}>
                {formatCsvExportBatchStatusLabel(batch.status)}
              </span>
            </div>

            <p className="csv-export__list-copy">{getHistorySnippet(batch)}</p>

            <dl className="csv-export__details">
              <div>
                <dt>Rows</dt>
                <dd>{batch.rowCount}</dd>
              </div>
              <div>
                <dt>Requested by</dt>
                <dd>{batch.requestedBy.name?.trim() || batch.requestedBy.email}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatTimestamp(batch.createdAt)}</dd>
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
              <p className="csv-export__history-error">{batch.lastError}</p>
            ) : null}

            <div className="csv-export__actions">
              <Link
                className="csv-export__button csv-export__button--secondary"
                href={getCsvExportBatchResultHref(batch.id)}
              >
                Open batch result
              </Link>

              {batch.status === "completed" ? (
                <a
                  className="csv-export__button csv-export__button--secondary"
                  download
                  href={getCsvExportBatchDownloadUrl(batch.id)}
                >
                  Download CSV
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CsvExportManagerView(props: CsvExportManagerViewProps): ReactElement {
  const {
    filters,
    historyState,
    createState,
    hasActiveFilters,
    catalogHref,
    onCreateFilteredExport,
    onMultiValueFilterTextChange,
    onNumericFilterChange,
    onQueryChange,
    onReloadHistory,
    onResetFilters,
  } = props;

  return (
    <div className="csv-export">
      <div className="csv-export__toolbar">
        <div className="csv-export__toolbar-copy">
          <p className="csv-export__eyebrow">Week 6 workspace</p>
          <h2>CSV export batches</h2>
          <p className="csv-export__panel-copy">
            Build filtered exports from catalog criteria here, and keep all of your selected and filtered export batches in one history view.
          </p>
        </div>

        <div className="csv-export__toolbar-actions">
          <Link className="csv-export__link" href={catalogHref}>
            Open catalog for selected exports
          </Link>
          <button
            className="csv-export__button csv-export__button--secondary"
            disabled={historyState.status === "loading"}
            onClick={onReloadHistory}
            type="button"
          >
            Refresh history
          </button>
        </div>
      </div>

      <div className="csv-export__layout">
        <section className="csv-export__panel" aria-labelledby="csv-export-filters-heading">
          <header className="csv-export__panel-header">
            <h2 id="csv-export-filters-heading">Create filtered export</h2>
            <p>
              Use the same creator filters as the catalog. At least one filter is required before creating a CSV batch from this page.
            </p>
          </header>

          <div className="csv-export__form-grid">
            <label className="csv-export__field">
              <span>Search</span>
              <input
                name="query"
                onChange={(event) => {
                  onQueryChange(event.target.value);
                }}
                placeholder="Search title, handle, or YouTube channel ID"
                suppressHydrationWarning
                type="search"
                value={filters.query}
              />
            </label>

            <label className="csv-export__field">
              <span>Country/Region</span>
              <input
                name="countryRegion"
                onChange={(event) => {
                  onMultiValueFilterTextChange("countryRegion", event.target.value);
                }}
                suppressHydrationWarning
                type="text"
                value={formatMultiValueText(filters.countryRegion)}
              />
            </label>

            <label className="csv-export__field">
              <span>Influencer Vertical</span>
              <input
                name="influencerVertical"
                onChange={(event) => {
                  onMultiValueFilterTextChange("influencerVertical", event.target.value);
                }}
                suppressHydrationWarning
                type="text"
                value={formatMultiValueText(filters.influencerVertical)}
              />
            </label>

            <label className="csv-export__field">
              <span>Influencer Type</span>
              <input
                name="influencerType"
                onChange={(event) => {
                  onMultiValueFilterTextChange("influencerType", event.target.value);
                }}
                suppressHydrationWarning
                type="text"
                value={formatMultiValueText(filters.influencerType)}
              />
            </label>

            <label className="csv-export__field">
              <span>YouTube Video Median Views Min</span>
              <input
                inputMode="numeric"
                min="0"
                name="youtubeVideoMedianViewsMin"
                onChange={(event) => {
                  onNumericFilterChange("youtubeVideoMedianViewsMin", event.target.value);
                }}
                pattern="[0-9]*"
                suppressHydrationWarning
                type="number"
                value={filters.youtubeVideoMedianViewsMin}
              />
            </label>

            <label className="csv-export__field">
              <span>YouTube Video Median Views Max</span>
              <input
                inputMode="numeric"
                min="0"
                name="youtubeVideoMedianViewsMax"
                onChange={(event) => {
                  onNumericFilterChange("youtubeVideoMedianViewsMax", event.target.value);
                }}
                pattern="[0-9]*"
                suppressHydrationWarning
                type="number"
                value={filters.youtubeVideoMedianViewsMax}
              />
            </label>

            <label className="csv-export__field">
              <span>YouTube Shorts Median Views Min</span>
              <input
                inputMode="numeric"
                min="0"
                name="youtubeShortsMedianViewsMin"
                onChange={(event) => {
                  onNumericFilterChange("youtubeShortsMedianViewsMin", event.target.value);
                }}
                pattern="[0-9]*"
                suppressHydrationWarning
                type="number"
                value={filters.youtubeShortsMedianViewsMin}
              />
            </label>

            <label className="csv-export__field">
              <span>YouTube Shorts Median Views Max</span>
              <input
                inputMode="numeric"
                min="0"
                name="youtubeShortsMedianViewsMax"
                onChange={(event) => {
                  onNumericFilterChange("youtubeShortsMedianViewsMax", event.target.value);
                }}
                pattern="[0-9]*"
                suppressHydrationWarning
                type="number"
                value={filters.youtubeShortsMedianViewsMax}
              />
            </label>

            <label className="csv-export__field">
              <span>YouTube Followers Min</span>
              <input
                inputMode="numeric"
                min="0"
                name="youtubeFollowersMin"
                onChange={(event) => {
                  onNumericFilterChange("youtubeFollowersMin", event.target.value);
                }}
                pattern="[0-9]*"
                suppressHydrationWarning
                type="number"
                value={filters.youtubeFollowersMin}
              />
            </label>

            <label className="csv-export__field">
              <span>YouTube Followers Max</span>
              <input
                inputMode="numeric"
                min="0"
                name="youtubeFollowersMax"
                onChange={(event) => {
                  onNumericFilterChange("youtubeFollowersMax", event.target.value);
                }}
                pattern="[0-9]*"
                suppressHydrationWarning
                type="number"
                value={filters.youtubeFollowersMax}
              />
            </label>
          </div>

          <div className="csv-export__actions">
            <button
              className="csv-export__button"
              disabled={!hasActiveFilters || createState.type === "submitting"}
              onClick={() => {
                void onCreateFilteredExport();
              }}
              suppressHydrationWarning
              type="button"
            >
              {createState.type === "submitting" ? "Creating export..." : "Create filtered export"}
            </button>
            <button
              className="csv-export__button csv-export__button--secondary"
              disabled={!hasActiveFilters}
              onClick={onResetFilters}
              suppressHydrationWarning
              type="button"
            >
              Reset filters
            </button>
          </div>

          <p className="csv-export__panel-copy">
            Need a hand-picked creator set instead? Use the catalog selection flow and start a selected export there.
          </p>

          {createState.message ? (
            <p
              className={`csv-export__create-status csv-export__create-status--${createState.type}`}
              role={createState.type === "error" ? "alert" : "status"}
            >
              {createState.message}
            </p>
          ) : null}
        </section>

        <section className="csv-export__panel" aria-labelledby="csv-export-history-heading">
          <header className="csv-export__panel-header">
            <h2 id="csv-export-history-heading">Recent export history</h2>
            <p>Newest batches appear first and auto-refresh while background work is still queued or running.</p>
          </header>

          {renderHistoryState(props)}
        </section>
      </div>
    </div>
  );
}

export function CsvExportManager() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const appliedFilters = parseCatalogFiltersFromSearchParams(searchParams);
  const appliedFiltersKey = buildCatalogFilterSearchParams(appliedFilters).toString();
  const [filters, setFilters] = useState<CatalogFiltersState>(appliedFilters);
  const [historyState, setHistoryState] = useState<CsvExportHistoryState>(INITIAL_HISTORY_STATE);
  const [createState, setCreateState] = useState<CsvExportCreateState>(IDLE_CREATE_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setFilters(appliedFilters);
  }, [appliedFiltersKey]);

  useEffect(() => {
    const abortController = new AbortController();
    const keepCurrentListVisible = historyState.status === "ready";

    if (!keepCurrentListVisible) {
      setHistoryState(INITIAL_HISTORY_STATE);
    } else {
      setIsRefreshing(true);
    }

    void (async () => {
      try {
        const items = await fetchCsvExportBatches(abortController.signal);

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
          setIsRefreshing(false);
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [reloadToken]);

  useEffect(() => {
    if (historyState.status !== "ready" || !shouldPollCsvExportBatches(historyState.items) || isRefreshing) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setReloadToken((current) => current + 1);
    }, CSV_EXPORT_HISTORY_POLL_INTERVAL_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [historyState, isRefreshing]);

  function updateFilters(nextFilters: CatalogFiltersState): void {
    setFilters(nextFilters);
    router.replace(buildCatalogFilterHref(pathname, nextFilters));

    if (createState.type !== "idle") {
      setCreateState(IDLE_CREATE_STATE);
    }
  }

  async function handleCreateFilteredExport(): Promise<void> {
    if (!hasActiveCatalogFilters(filters)) {
      setCreateState({
        type: "error",
        message: "Choose at least one filter before creating a filtered export.",
      });
      return;
    }

    setCreateState({
      type: "submitting",
      message: "",
    });

    try {
      const batch = await createCsvExportBatch({
        type: "filtered",
        filters: buildCatalogChannelFilters(filters),
      });

      setCreateState({
        type: "success",
        message: getCreateSuccessMessage(batch),
      });
      setHistoryState((current) => ({
        status: "ready",
        items: upsertCsvExportBatch(current.items, batch),
        error: null,
      }));
      setReloadToken((current) => current + 1);
    } catch (error) {
      setCreateState({
        type: "error",
        message: getCreateErrorMessage(error),
      });
    }
  }

  function handleQueryChange(value: string): void {
    updateFilters({
      ...filters,
      query: value,
    });
  }

  function handleMultiValueFilterTextChange(
    key: CatalogMultiValueFilterKey,
    value: string,
  ): void {
    updateFilters({
      ...filters,
      [key]: parseMultiValueText(value),
    });
  }

  function handleNumericFilterChange(key: CatalogNumericFilterKey, value: string): void {
    updateFilters({
      ...filters,
      [key]: normalizeCatalogNumericFilterValue(value),
    });
  }

  function handleResetFilters(): void {
    updateFilters(DEFAULT_CATALOG_FILTERS);
  }

  function handleReloadHistory(): void {
    setReloadToken((current) => current + 1);
  }

  function handleRetryHistory(): void {
    setHistoryState(INITIAL_HISTORY_STATE);
    setReloadToken((current) => current + 1);
  }

  return (
    <CsvExportManagerView
      catalogHref={buildCatalogHref("/catalog", { page: 1, filters })}
      createState={createState}
      filters={filters}
      hasActiveFilters={hasActiveCatalogFilters(filters)}
      historyState={historyState}
      isRefreshing={isRefreshing}
      onCreateFilteredExport={handleCreateFilteredExport}
      onMultiValueFilterTextChange={handleMultiValueFilterTextChange}
      onNumericFilterChange={handleNumericFilterChange}
      onQueryChange={handleQueryChange}
      onReloadHistory={handleReloadHistory}
      onResetFilters={handleResetFilters}
      onRetryHistory={handleRetryHistory}
    />
  );
}
