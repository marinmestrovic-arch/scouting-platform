"use client";

import type {
  CsvExportBatchStatus,
  CsvExportBatchSummary,
  CsvExportScopeType,
} from "@scouting-platform/contracts";
import Link from "next/link";
import { useEffect, useState, type ReactElement } from "react";

import {
  CsvExportBatchesApiError,
  fetchCsvExportBatches,
  getCsvExportBatchDownloadUrl,
} from "../../lib/csv-export-batches-api";
import { getCsvExportBatchResultHref } from "../../lib/navigation";

type CsvExportHistoryState = {
  status: "loading" | "error" | "ready";
  items: CsvExportBatchSummary[];
  error: string | null;
};

type CsvExportManagerViewProps = Readonly<{
  historyState: CsvExportHistoryState;
  isRefreshing: boolean;
  onReloadHistory: () => void;
  onRetryHistory: () => void;
}>;

const INITIAL_HISTORY_STATE: CsvExportHistoryState = {
  status: "loading",
  items: [],
  error: null,
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

function getHistoryErrorMessage(error: unknown): string {
  if (error instanceof CsvExportBatchesApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow CSV export history review anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to load CSV export history. Please try again.");
}

export function formatCsvExportBatchStatusLabel(status: CsvExportBatchStatus): string {
  return toTitleCase(status);
}

export function shouldPollCsvExportBatches(
  items: readonly Pick<CsvExportBatchSummary, "status">[],
): boolean {
  return items.some((item) => item.status === "queued" || item.status === "running");
}

function renderHistoryState(props: CsvExportManagerViewProps): ReactElement {
  const { historyState, isRefreshing, onRetryHistory } = props;

  if (historyState.status === "loading" && historyState.items.length === 0) {
    return (
      <div className="csv-export__feedback csv-export__feedback--loading" role="status">
        <p>Loading exports...</p>
      </div>
    );
  }

  if (historyState.status === "error" && historyState.items.length === 0) {
    return (
      <div className="csv-export__feedback csv-export__feedback--error" role="alert">
        <p>{historyState.error ?? "Unable to load exports."}</p>
        <button className="csv-export__button" onClick={onRetryHistory} type="button">
          Retry
        </button>
      </div>
    );
  }

  if (historyState.items.length === 0) {
    return (
      <div className="csv-export__empty-state">
        <h3>No exports yet</h3>
        <p>
          Start an export from a scouting run — choose <strong>Export to Google Sheets</strong> on the
          run detail page. Past CSV downloads will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="csv-export__history-stack">
      {isRefreshing ? (
        <p className="csv-export__inline-note" role="status">
          Refreshing exports...
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
                Open export
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
  const { historyState, onReloadHistory } = props;

  return (
    <div className="csv-export">
      <div className="csv-export__toolbar">
        <div className="csv-export__toolbar-copy">
          <h2>Your exports</h2>
          <p className="csv-export__panel-copy">
            Every export you create from a scouting run shows up here. Open one to review the rows or
            download the CSV file.
          </p>
        </div>

        <div className="csv-export__toolbar-actions">
          <button
            className="csv-export__button csv-export__button--secondary"
            disabled={historyState.status === "loading"}
            onClick={onReloadHistory}
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      <section className="csv-export__panel" aria-labelledby="csv-export-history-heading">
        <header className="csv-export__panel-header">
          <h2 id="csv-export-history-heading">Recent exports</h2>
          <p>Newest exports appear first and auto-refresh while background work is still queued or running.</p>
        </header>

        {renderHistoryState(props)}
      </section>
    </div>
  );
}

export function CsvExportManager() {
  const [historyState, setHistoryState] = useState<CsvExportHistoryState>(INITIAL_HISTORY_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  function handleReloadHistory(): void {
    setReloadToken((current) => current + 1);
  }

  function handleRetryHistory(): void {
    setHistoryState(INITIAL_HISTORY_STATE);
    setReloadToken((current) => current + 1);
  }

  return (
    <CsvExportManagerView
      historyState={historyState}
      isRefreshing={isRefreshing}
      onReloadHistory={handleReloadHistory}
      onRetryHistory={handleRetryHistory}
    />
  );
}
