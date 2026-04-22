"use client";

import { isCatalogScoutingQuery, type RunResultItem, type RunStatusResponse } from "@scouting-platform/contracts";
import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import { ApiRequestError, fetchRunStatus } from "../../lib/runs-api";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { StatusPill } from "../ui/StatusPill";
import { StatusTimeline } from "../ui/StatusTimeline";
import {
  RUN_STATUS_POLL_INTERVAL_MS,
  formatRunResultCount as formatRunResultCountValue,
  getRunJobFeedback,
  getRunResultsEmptyMessage,
  formatRunStatusLabel,
  formatRunTimestamp,
  getRunFailureMessage,
  getRunStatusSummary,
  shouldPollRunStatus,
} from "./run-presentation";

type RunDetailShellProps = Readonly<{
  runId: string;
  initialData?: RunStatusResponse | null;
}>;

type RunDetailRequestState =
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
      status: "notFound";
      data: null;
      error: null;
    }
  | {
      status: "ready";
      data: RunStatusResponse;
      error: null;
    };

type RunDetailShellViewProps = RunDetailShellProps & {
  requestState: RunDetailRequestState;
  onRetry: () => void;
};

const INITIAL_REQUEST_STATE: RunDetailRequestState = {
  status: "loading",
  data: null,
  error: null,
};

const NOT_FOUND_REQUEST_STATE: RunDetailRequestState = {
  status: "notFound",
  data: null,
  error: null,
};

export { RUN_STATUS_POLL_INTERVAL_MS, formatRunStatusLabel, formatRunTimestamp, getRunFailureMessage, shouldPollRunStatus };

export function formatRunResultCount(run: Pick<RunStatusResponse, "results">): string {
  return formatRunResultCountValue(run.results.length);
}

export function getRunProgressMessage(run: Pick<RunStatusResponse, "status" | "results">): string {
  return getRunStatusSummary({
    status: run.status,
    resultCount: run.results.length,
    lastError: null,
  });
}

export function getRunDetailRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) {
      return "Your session does not allow access to this run anymore. Sign in again and retry.";
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to load run details. Please try again.";
}

function getResultIdentityFallback(result: RunResultItem): string {
  return result.channel.title.trim().charAt(0).toUpperCase() || "?";
}

function renderResultCard(result: RunResultItem) {
  return (
    <li className="run-detail__result-card" key={result.id}>
      <div className="run-detail__result-media">
        {result.channel.thumbnailUrl ? (
          <Image
            alt={`${result.channel.title} thumbnail`}
            className="run-detail__result-thumbnail"
            height={64}
            src={result.channel.thumbnailUrl}
            width={64}
          />
        ) : (
          <div
            aria-hidden="true"
            className="run-detail__result-thumbnail run-detail__result-thumbnail--fallback"
          >
            {getResultIdentityFallback(result)}
          </div>
        )}
      </div>

      <div className="run-detail__result-copy">
        <div className="run-detail__result-header">
          <p className="run-detail__result-rank">Rank {result.rank}</p>
          <span className={`run-detail__source run-detail__source--${result.source}`}>
            {result.source === "catalog" ? "Catalog match" : "New discovery"}
          </span>
        </div>

        <h3>{result.channel.title}</h3>
        <p className="run-detail__result-handle">
          {result.channel.handle?.trim() || result.channel.youtubeChannelId}
        </p>
        <p className="run-detail__result-meta">
          Catalog ID <code>{result.channelId}</code>
        </p>
        <div className="run-detail__result-actions">
          <Link href={`/catalog/${result.channelId}`}>Open catalog detail</Link>
        </div>
      </div>
    </li>
  );
}

function getRunQueryLabel(query: string): string {
  return isCatalogScoutingQuery(query) ? "Criteria" : "Query";
}

function getRunTimelineSteps(status: RunStatusResponse["status"]) {
  if (status === "queued") {
    return [
      { key: "queued", label: "Queued", state: "active" as const },
      { key: "running", label: "Running", state: "todo" as const },
      { key: "completed", label: "Completed", state: "todo" as const },
      { key: "failed", label: "Failed", state: "todo" as const },
    ];
  }

  if (status === "running") {
    return [
      { key: "queued", label: "Queued", state: "done" as const },
      { key: "running", label: "Running", state: "active" as const },
      { key: "completed", label: "Completed", state: "todo" as const },
      { key: "failed", label: "Failed", state: "todo" as const },
    ];
  }

  if (status === "completed") {
    return [
      { key: "queued", label: "Queued", state: "done" as const },
      { key: "running", label: "Running", state: "done" as const },
      { key: "completed", label: "Completed", state: "done" as const },
      { key: "failed", label: "Failed", state: "todo" as const },
    ];
  }

  return [
    { key: "queued", label: "Queued", state: "done" as const },
    { key: "running", label: "Running", state: "done" as const },
    { key: "completed", label: "Completed", state: "todo" as const },
    { key: "failed", label: "Failed", state: "active" as const },
  ];
}

function renderReadyState(run: RunStatusResponse, onRetry: () => void) {
  const jobFeedback = getRunJobFeedback({
    status: run.status,
    resultCount: run.results.length,
    lastError: run.lastError,
  });

  return (
    <>
      <section aria-labelledby="run-detail-heading" className="run-detail__hero">
        <div className="run-detail__hero-copy">
          <p className="run-detail__eyebrow">Run snapshot</p>
          <h2 id="run-detail-heading">{run.name}</h2>
          <p className="run-detail__query">
            {getRunQueryLabel(run.query)}: {run.query}
          </p>
          <div className="run-detail__status-row">
            <StatusPill status={run.status} />
            <p className="run-detail__status-copy">{getRunProgressMessage(run)}</p>
          </div>
          <StatusTimeline steps={getRunTimelineSteps(run.status)} />
        </div>

        <dl className="run-detail__meta-grid">
          <div>
            <dt>Run ID</dt>
            <dd>
              <code>{run.id}</code>
            </dd>
          </div>
          <div>
            <dt>Results</dt>
            <dd>{formatRunResultCount(run)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatRunTimestamp(run.updatedAt)}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatRunTimestamp(run.createdAt)}</dd>
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
      </section>

      <section
        aria-labelledby="run-detail-job-feedback-heading"
        className={`run-detail__job-feedback run-detail__job-feedback--${jobFeedback.tone}`}
      >
        <div>
          <p className="run-detail__eyebrow">Worker feedback</p>
          <h3 id="run-detail-job-feedback-heading">{jobFeedback.title}</h3>
          <p>{jobFeedback.summary}</p>
          <p>{jobFeedback.nextStep}</p>
          {jobFeedback.autoRefresh ? (
            <p className="run-detail__job-feedback-note">
              Auto-refresh is active while this scouting job is still queued or running.
            </p>
          ) : null}
        </div>
      </section>

      {run.status === "failed" ? (
        <section aria-labelledby="run-detail-error-heading" className="run-detail__feedback run-detail__feedback--error">
          <div>
            <h3 id="run-detail-error-heading">Run failed</h3>
            <p>{getRunFailureMessage(run)}</p>
          </div>
          <button className="run-detail__button" onClick={onRetry} type="button">
            Retry status check
          </button>
        </section>
      ) : null}

      <section aria-labelledby="run-detail-results-heading" className="run-detail__panel">
        <header className="run-detail__panel-header">
          <div>
            <h2 id="run-detail-results-heading">Snapshot results</h2>
            <p>
              Stored in rank order so the run remains reproducible even after catalog data changes.
              Use the catalog links below to review each channel&apos;s enrichment status.
            </p>
          </div>
          <button className="run-detail__button run-detail__button--secondary" onClick={onRetry} type="button">
            Refresh now
          </button>
        </header>

        {run.results.length > 0 ? (
          <ul className="run-detail__results-list">{run.results.map((result) => renderResultCard(result))}</ul>
        ) : (
          <p className="run-detail__empty-state">{getRunResultsEmptyMessage({
            status: run.status,
            resultCount: run.results.length,
            lastError: run.lastError,
          })}</p>
        )}
      </section>
    </>
  );
}

export function RunDetailShellView({ runId, requestState, onRetry }: RunDetailShellViewProps) {
  if (requestState.status === "loading") {
    return (
      <section className="run-detail__feedback run-detail__feedback--loading" role="status">
        Loading run status for <code>{runId}</code>.
      </section>
    );
  }

  if (requestState.status === "error") {
    return (
      <ErrorState description={requestState.error} onRetry={onRetry} title="Run status unavailable" />
    );
  }

  if (requestState.status === "notFound") {
    return (
      <EmptyState
        description="The requested run does not exist or is no longer visible to this account."
        title="Run not found"
      />
    );
  }

  return <div className="run-detail">{renderReadyState(requestState.data, onRetry)}</div>;
}

export function RunDetailShell({ initialData, runId }: RunDetailShellProps) {
  const [requestState, setRequestState] = useState<RunDetailRequestState>(
    initialData
      ? {
          status: "ready",
          data: initialData,
          error: null,
        }
      : initialData === null
        ? NOT_FOUND_REQUEST_STATE
        : INITIAL_REQUEST_STATE,
  );
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const canReuseInitialData = reloadToken === 0 && !!initialData;

    async function loadRun(polling = false) {
      if (!polling && !canReuseInitialData) {
        setRequestState(INITIAL_REQUEST_STATE);
      }

      try {
        const run =
          canReuseInitialData && !polling ? initialData : await fetchRunStatus(runId, abortController.signal);

        if (didCancel) {
          return;
        }

        if (!run) {
          setRequestState(NOT_FOUND_REQUEST_STATE);
          return;
        }

        setRequestState({
          status: "ready",
          data: run,
          error: null,
        });

        if (shouldPollRunStatus(run.status)) {
          timeoutId = setTimeout(() => {
            void loadRun(true);
          }, RUN_STATUS_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (didCancel) {
          return;
        }

        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        if (error instanceof ApiRequestError && error.status === 404) {
          setRequestState(NOT_FOUND_REQUEST_STATE);
          return;
        }

        setRequestState({
          status: "error",
          data: null,
          error: getRunDetailRequestErrorMessage(error),
        });
      }
    }

    void loadRun();

    return () => {
      didCancel = true;
      abortController.abort();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [initialData, reloadToken, runId]);

  function handleRetry() {
    setReloadToken((current) => current + 1);
  }

  return <RunDetailShellView onRetry={handleRetry} requestState={requestState} runId={runId} />;
}
