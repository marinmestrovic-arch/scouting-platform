"use client";

import type {
  ListRecentRunsResponse,
  RunResultItem,
  RunStatusResponse,
} from "@scouting-platform/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import { getCsvExportBatchResultHref, getHubspotPushBatchResultHref } from "../../lib/navigation";
import {
  createCsvExportBatchFromRun,
  createHubspotPushBatchFromRun,
  RunBatchActionError,
} from "../../lib/run-batch-actions";
import { fetchRecentRuns, fetchRunStatus } from "../../lib/runs-api";
import {
  formatRunResultCount,
  formatRunStatusLabel,
  formatRunTimestamp,
  getRunFailureMessage,
  getRunStatusSummary,
  RUN_STATUS_POLL_INTERVAL_MS,
  shouldPollRunStatus,
} from "../runs/run-presentation";

type DatabaseRunsTabProps = Readonly<{
  requestedRunId: string | null;
  onSelectRun: (runId: string) => void;
}>;

type RecentRunsRequestState =
  | { status: "loading"; data: null; error: null }
  | { status: "error"; data: null; error: string }
  | { status: "ready"; data: ListRecentRunsResponse; error: null };

type RunDetailRequestState =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: null; error: null }
  | { status: "error"; data: null; error: string }
  | { status: "ready"; data: RunStatusResponse; error: null };

type RunBatchActionState = {
  action: "csv" | "hubspot" | null;
  runId: string | null;
  status: "idle" | "submitting" | "error";
  message: string;
};

const INITIAL_RECENT_RUNS_REQUEST_STATE: RecentRunsRequestState = {
  status: "loading",
  data: null,
  error: null,
};

const INITIAL_RUN_DETAIL_REQUEST_STATE: RunDetailRequestState = {
  status: "idle",
  data: null,
  error: null,
};

const IDLE_BATCH_ACTION_STATE: RunBatchActionState = {
  action: null,
  runId: null,
  status: "idle",
  message: "",
};

function getRecentRunsErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to load recent runs. Please try again.";
}

function getRunDetailErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to load the selected run. Please try again.";
}

function getRunBatchActionErrorMessage(action: "csv" | "hubspot", error: unknown): string {
  if (error instanceof RunBatchActionError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return action === "csv"
    ? "Unable to create the CSV export for this run."
    : "Unable to start the HubSpot push for this run.";
}

function getResultIdentityFallback(result: RunResultItem): string {
  return result.channel.title.trim().charAt(0).toUpperCase() || "?";
}

function renderResultCard(result: RunResultItem) {
  return (
    <li className="database-runs__result-card" key={result.id}>
      <div aria-hidden="true" className="database-runs__result-badge">
        {getResultIdentityFallback(result)}
      </div>
      <div>
        <div className="database-runs__result-header">
          <p>{result.channel.title}</p>
          <span className={`database-runs__source database-runs__source--${result.source}`}>
            {result.source === "catalog" ? "Catalog match" : "New discovery"}
          </span>
        </div>
        <p className="database-runs__result-meta">
          Rank {result.rank} · {result.channel.handle?.trim() || result.channel.youtubeChannelId}
        </p>
        <Link className="database-runs__result-link" href={`/catalog/${result.channelId}`}>
          Open creator detail
        </Link>
      </div>
    </li>
  );
}

export function DatabaseRunsTab({
  onSelectRun,
  requestedRunId,
}: DatabaseRunsTabProps) {
  const router = useRouter();
  const [recentRunsRequestState, setRecentRunsRequestState] =
    useState<RecentRunsRequestState>(INITIAL_RECENT_RUNS_REQUEST_STATE);
  const [detailRequestState, setDetailRequestState] =
    useState<RunDetailRequestState>(INITIAL_RUN_DETAIL_REQUEST_STATE);
  const [recentRunsReloadToken, setRecentRunsReloadToken] = useState(0);
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  const [actionState, setActionState] = useState<RunBatchActionState>(IDLE_BATCH_ACTION_STATE);

  useEffect(() => {
    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function loadRuns(polling = false) {
      if (!polling) {
        setRecentRunsRequestState(INITIAL_RECENT_RUNS_REQUEST_STATE);
      }

      try {
        const recentRuns = await fetchRecentRuns(abortController.signal);

        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setRecentRunsRequestState({
          status: "ready",
          data: recentRuns,
          error: null,
        });

        if (recentRuns.items.some((run) => shouldPollRunStatus(run.status))) {
          timeoutId = setTimeout(() => {
            void loadRuns(true);
          }, RUN_STATUS_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setRecentRunsRequestState({
          status: "error",
          data: null,
          error: getRecentRunsErrorMessage(error),
        });
      }
    }

    void loadRuns();

    return () => {
      didCancel = true;
      abortController.abort();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [recentRunsReloadToken]);

  const selectedRunId = useMemo(() => {
    if (requestedRunId) {
      return requestedRunId;
    }

    if (recentRunsRequestState.status !== "ready") {
      return null;
    }

    return recentRunsRequestState.data.items[0]?.id ?? null;
  }, [recentRunsRequestState, requestedRunId]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetailRequestState(INITIAL_RUN_DETAIL_REQUEST_STATE);
      return;
    }

    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    setDetailRequestState({
      status: "loading",
      data: null,
      error: null,
    });

    async function loadDetail(polling = false) {
      if (!polling) {
        setDetailRequestState({
          status: "loading",
          data: null,
          error: null,
        });
      }

      try {
        const run = await fetchRunStatus(selectedRunId, abortController.signal);

        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setDetailRequestState({
          status: "ready",
          data: run,
          error: null,
        });

        if (shouldPollRunStatus(run.status)) {
          timeoutId = setTimeout(() => {
            void loadDetail(true);
          }, RUN_STATUS_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setDetailRequestState({
          status: "error",
          data: null,
          error: getRunDetailErrorMessage(error),
        });
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
  }, [detailReloadToken, selectedRunId]);

  async function handleCreateBatchAction(runId: string, action: "csv" | "hubspot") {
    setActionState({
      action,
      runId,
      status: "submitting",
      message:
        action === "csv"
          ? "Creating CSV export from this run."
          : "Creating HubSpot push from this run.",
    });

    try {
      if (action === "csv") {
        const batch = await createCsvExportBatchFromRun(runId);
        router.push(getCsvExportBatchResultHref(batch.id));
        return;
      }

      const batch = await createHubspotPushBatchFromRun(runId);
      router.push(getHubspotPushBatchResultHref(batch.id));
    } catch (error) {
      setActionState({
        action,
        runId,
        status: "error",
        message: getRunBatchActionErrorMessage(action, error),
      });
    }
  }

  return (
    <div className="database-runs">
      <section className="database-runs__panel">
        <header className="database-runs__panel-header">
          <div>
            <p className="workspace-eyebrow">Run snapshots</p>
            <h2>Runs</h2>
            <p className="workspace-copy">
              Select a run to review the stored snapshot, then export or push every creator from
              that result set without leaving Database.
            </p>
          </div>

          {selectedRunId ? (
            <div className="database-runs__header-actions">
              <button
                className="workspace-button workspace-button--small"
                disabled={actionState.status === "submitting"}
                onClick={() => {
                  void handleCreateBatchAction(selectedRunId, "csv");
                }}
                type="button"
              >
                Export CSV
              </button>
              <button
                className="workspace-button workspace-button--small workspace-button--secondary"
                disabled={actionState.status === "submitting"}
                onClick={() => {
                  void handleCreateBatchAction(selectedRunId, "hubspot");
                }}
                type="button"
              >
                Import to HubSpot
              </button>
            </div>
          ) : null}
        </header>

        {actionState.status === "error" ? (
          <p className="database-runs__inline-error" role="alert">
            {actionState.message}
          </p>
        ) : null}

        {recentRunsRequestState.status === "loading" ? (
          <div className="database-runs__feedback" role="status">
            Loading recent runs.
          </div>
        ) : null}

        {recentRunsRequestState.status === "error" ? (
          <div className="database-runs__feedback database-runs__feedback--error" role="alert">
            <p>{recentRunsRequestState.error}</p>
            <button
              onClick={() => {
                setRecentRunsReloadToken((current) => current + 1);
              }}
              type="button"
            >
              Retry runs
            </button>
          </div>
        ) : null}

        {recentRunsRequestState.status === "ready" ? (
          recentRunsRequestState.data.items.length > 0 ? (
            <div className="database-runs__table-shell">
              <table className="database-runs__table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Status</th>
                    <th>Results</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRunsRequestState.data.items.map((run) => {
                    const isSelected = selectedRunId === run.id;
                    const isBusy = actionState.status === "submitting" && actionState.runId === run.id;

                    return (
                      <tr className={isSelected ? "database-runs__row--selected" : undefined} key={run.id}>
                        <td>
                          <button
                            className="database-runs__select-button"
                            onClick={() => {
                              onSelectRun(run.id);
                            }}
                            type="button"
                          >
                            <span>{run.name}</span>
                            <small>{run.query}</small>
                          </button>
                        </td>
                        <td>
                          <span className={`database-runs__status database-runs__status--${run.status}`}>
                            {formatRunStatusLabel(run.status)}
                          </span>
                        </td>
                        <td>{formatRunResultCount(run.resultCount)}</td>
                        <td>{formatRunTimestamp(run.updatedAt)}</td>
                        <td>
                          <div className="database-runs__row-actions">
                            <button
                              className="workspace-button workspace-button--small"
                              disabled={isBusy}
                              onClick={() => {
                                void handleCreateBatchAction(run.id, "csv");
                              }}
                              type="button"
                            >
                              Export CSV
                            </button>
                            <button
                              className="workspace-button workspace-button--small workspace-button--secondary"
                              disabled={isBusy}
                              onClick={() => {
                                void handleCreateBatchAction(run.id, "hubspot");
                              }}
                              type="button"
                            >
                              HubSpot
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="database-runs__empty-state">
              <h3>No runs yet</h3>
              <p>Create the first scouting run, then review its stored snapshot here.</p>
              <Link href="/new-scouting">Open New scouting</Link>
            </div>
          )
        ) : null}
      </section>

      <section className="database-runs__panel">
        <header className="database-runs__panel-header">
          <div>
            <p className="workspace-eyebrow">Selected run</p>
            <h2>Snapshot detail</h2>
          </div>

          <button
            className="workspace-button workspace-button--small workspace-button--secondary"
            disabled={!selectedRunId}
            onClick={() => {
              setDetailReloadToken((current) => current + 1);
            }}
            type="button"
          >
            Refresh detail
          </button>
        </header>

        {!selectedRunId ? (
          <div className="database-runs__empty-state">
            <h3>Select a run</h3>
            <p>Choose a run above to inspect its snapshot and run-level actions.</p>
          </div>
        ) : null}

        {detailRequestState.status === "loading" ? (
          <div className="database-runs__feedback" role="status">
            Loading selected run detail.
          </div>
        ) : null}

        {detailRequestState.status === "error" ? (
          <div className="database-runs__feedback database-runs__feedback--error" role="alert">
            <p>{detailRequestState.error}</p>
            <button
              onClick={() => {
                setDetailReloadToken((current) => current + 1);
              }}
              type="button"
            >
              Retry detail
            </button>
          </div>
        ) : null}

        {detailRequestState.status === "ready" ? (
          <>
            <div className="database-runs__detail-hero">
              <div>
                <h3>{detailRequestState.data.name}</h3>
                <p className="database-runs__detail-query">{detailRequestState.data.query}</p>
              </div>

              <span
                className={`database-runs__status database-runs__status--${detailRequestState.data.status}`}
              >
                {formatRunStatusLabel(detailRequestState.data.status)}
              </span>
            </div>

            <p className="database-runs__detail-summary">
              {getRunStatusSummary({
                status: detailRequestState.data.status,
                resultCount: detailRequestState.data.results.length,
                lastError: detailRequestState.data.lastError,
              })}
            </p>

            {detailRequestState.data.status === "failed" ? (
              <p className="database-runs__inline-error" role="alert">
                {getRunFailureMessage(detailRequestState.data)}
              </p>
            ) : null}

            <dl className="database-runs__meta-grid">
              <div>
                <dt>Created</dt>
                <dd>{formatRunTimestamp(detailRequestState.data.createdAt)}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatRunTimestamp(detailRequestState.data.startedAt)}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{formatRunTimestamp(detailRequestState.data.completedAt)}</dd>
              </div>
              <div>
                <dt>Results</dt>
                <dd>{formatRunResultCount(detailRequestState.data.results.length)}</dd>
              </div>
            </dl>

            {detailRequestState.data.results.length > 0 ? (
              <ul className="database-runs__results-list">
                {detailRequestState.data.results.map((result) => renderResultCard(result))}
              </ul>
            ) : (
              <div className="database-runs__empty-state">
                <h3>No creators saved yet</h3>
                <p>
                  This run has not stored snapshot rows yet. Leave the page open while queued or
                  running jobs refresh.
                </p>
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
