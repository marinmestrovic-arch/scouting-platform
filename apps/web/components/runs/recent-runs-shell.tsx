"use client";

import type { ListRecentRunsResponse, RecentRunItem } from "@scouting-platform/contracts";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import { ApiRequestError, fetchRecentRuns } from "../../lib/runs-api";
import {
  RUN_STATUS_POLL_INTERVAL_MS,
  formatRunResultCount,
  formatRunStatusLabel,
  formatRunTimestamp,
  getRunJobFeedback,
  getRunStatusSummary,
  shouldPollRunStatus,
} from "./run-presentation";

type RecentRunsRequestState =
  | {
      status: "loading";
      data: null;
      error: null;
    }
  | {
      status: "error";
      data: null;
      error: string;
    }
  | {
      status: "ready";
      data: ListRecentRunsResponse;
      error: null;
    };

type RecentRunsShellViewProps = {
  requestState: RecentRunsRequestState;
  onRetry: () => void;
};

const INITIAL_REQUEST_STATE: RecentRunsRequestState = {
  status: "loading",
  data: null,
  error: null,
};

export function getRecentRunsRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) {
      return "Your session does not allow access to recent runs anymore. Sign in again and retry.";
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to load recent runs. Please try again.";
}

export function hasActiveRecentRuns(runs: readonly RecentRunItem[]): boolean {
  return runs.some((run) => shouldPollRunStatus(run.status));
}

export function getRecentRunsSummary(data: ListRecentRunsResponse): string {
  if (data.items.length === 0) {
    return "No recent runs yet";
  }

  if (data.items.length === 1) {
    return "1 recent run";
  }

  return `${data.items.length} recent runs`;
}

export function getRecentRunProgressMessage(
  run: Pick<RecentRunItem, "status" | "resultCount" | "lastError">,
): string {
  return getRunStatusSummary(run);
}

function renderRunCard(run: RecentRunItem) {
  const jobFeedback = getRunJobFeedback({
    status: run.status,
    resultCount: run.resultCount,
    lastError: run.lastError,
  });

  return (
    <li className="recent-runs__item" key={run.id}>
      <div className="recent-runs__item-header">
        <div>
          <p className="recent-runs__eyebrow">Run snapshot</p>
          <h3>{run.name}</h3>
          <p className="recent-runs__query">Query: {run.query}</p>
        </div>

        <span className={`recent-runs__status recent-runs__status--${run.status}`}>
          {formatRunStatusLabel(run.status)}
        </span>
      </div>

      <p className="recent-runs__copy">{getRecentRunProgressMessage(run)}</p>

      <div className={`recent-runs__job-feedback recent-runs__job-feedback--${jobFeedback.tone}`}>
        <h4>{jobFeedback.title}</h4>
        <p>{jobFeedback.summary}</p>
        <p>{jobFeedback.nextStep}</p>
        {jobFeedback.autoRefresh ? (
          <p className="recent-runs__job-feedback-note">
            Auto-refresh is active while this job is queued or running.
          </p>
        ) : null}
      </div>

      <dl className="recent-runs__meta-grid">
        <div>
          <dt>Results</dt>
          <dd>{formatRunResultCount(run.resultCount)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatRunTimestamp(run.createdAt)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatRunTimestamp(run.updatedAt)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatRunTimestamp(run.startedAt)}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{formatRunTimestamp(run.completedAt)}</dd>
        </div>
      </dl>

      <div className="recent-runs__actions">
        <Link className="recent-runs__link" href={`/runs/${run.id}`}>
          Open run detail
        </Link>
      </div>
    </li>
  );
}

function renderReadyState(data: ListRecentRunsResponse, onRetry: () => void) {
  return (
    <section aria-labelledby="recent-runs-heading" className="recent-runs__panel">
      <header className="recent-runs__header">
        <div>
          <h2 id="recent-runs-heading">Recent runs</h2>
          <p className="recent-runs__summary">Latest 10 snapshots for this account. {getRecentRunsSummary(data)}.</p>
        </div>

        <button
          className="recent-runs__button recent-runs__button--secondary"
          onClick={onRetry}
          type="button"
        >
          Refresh now
        </button>
      </header>

      {data.items.length > 0 ? (
        <ul className="recent-runs__list">{data.items.map((run) => renderRunCard(run))}</ul>
      ) : (
        <p className="recent-runs__empty-state">
          No runs yet. Create a scouting run above to start building snapshot history.
        </p>
      )}
    </section>
  );
}

export function RecentRunsShellView({ requestState, onRetry }: RecentRunsShellViewProps) {
  if (requestState.status === "loading") {
    return (
      <section className="recent-runs__feedback recent-runs__feedback--loading" role="status">
        Loading recent runs.
      </section>
    );
  }

  if (requestState.status === "error") {
    return (
      <section className="recent-runs__feedback recent-runs__feedback--error" role="alert">
        <div>
          <h2>Recent runs unavailable</h2>
          <p>{requestState.error}</p>
        </div>
        <button className="recent-runs__button" onClick={onRetry} type="button">
          Retry
        </button>
      </section>
    );
  }

  return <div className="recent-runs">{renderReadyState(requestState.data, onRetry)}</div>;
}

export function RecentRunsShell() {
  const [requestState, setRequestState] = useState<RecentRunsRequestState>(INITIAL_REQUEST_STATE);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function loadRuns(polling = false) {
      if (!polling) {
        setRequestState(INITIAL_REQUEST_STATE);
      }

      try {
        const recentRuns = await fetchRecentRuns(abortController.signal);

        if (didCancel) {
          return;
        }

        setRequestState({
          status: "ready",
          data: recentRuns,
          error: null,
        });

        if (hasActiveRecentRuns(recentRuns.items)) {
          timeoutId = setTimeout(() => {
            void loadRuns(true);
          }, RUN_STATUS_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (didCancel) {
          return;
        }

        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setRequestState({
          status: "error",
          data: null,
          error: getRecentRunsRequestErrorMessage(error),
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
  }, [reloadToken]);

  function handleRetry() {
    setReloadToken((current) => current + 1);
  }

  return <RecentRunsShellView onRetry={handleRetry} requestState={requestState} />;
}
