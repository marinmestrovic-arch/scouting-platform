"use client";

import {
  isCatalogScoutingQuery,
  type RunChannelAssessmentItem,
  type RunResultItem,
  type RunStatusResponse,
} from "@scouting-platform/contracts";
import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import { ApiRequestError, fetchRunStatus } from "../../lib/runs-api";
import { getExportPreviewHref } from "../../lib/navigation";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { StatusPill } from "../ui/StatusPill";
import { StatusTimeline } from "../ui/StatusTimeline";
import { RunResultRating } from "./run-result-rating";
import {
  RUN_STATUS_POLL_INTERVAL_MS,
  formatRunResultCount as formatRunResultCountValue,
  getRunJobFeedback,
  getRunResultsEmptyMessage,
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

export { RUN_STATUS_POLL_INTERVAL_MS, getRunFailureMessage, shouldPollRunStatus };

export function formatRunResultCount(run: Pick<RunStatusResponse, "results">): string {
  return formatRunResultCountValue(run.results.length);
}

function getRunProgressMessage(run: Pick<RunStatusResponse, "status" | "results">): string {
  return getRunStatusSummary({
    status: run.status,
    resultCount: run.results.length,
    lastError: null,
  });
}

function getRunDetailRequestErrorMessage(error: unknown): string {
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

function getFitScorePresentation(score: number): {
  label: string;
  tone: "strong" | "mixed" | "low";
} {
  const percentage = Math.round(score * 100);

  if (score >= 0.7) {
    return { label: `${percentage}% fit - Strong fit`, tone: "strong" };
  }

  if (score >= 0.4) {
    return { label: `${percentage}% fit - Mixed fit`, tone: "mixed" };
  }

  return { label: `${percentage}% fit - Low fit`, tone: "low" };
}

function toTitleCaseStart(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function compactFitReason(item: string): string {
  const normalized = item.replace(/\s+/g, " ").trim();
  const withoutChannelLead = normalized
    .replace(/^The channel ['"][^'"]+['"] is\s+/i, "")
    .replace(/^The channel is\s+/i, "")
    .replace(/^The channel's\s+/i, "")
    .replace(/^The channel\s+/i, "");
  const weeklyMatch = withoutChannelLead.match(/\bpublishes?\s+(daily|weekly|monthly|regularly)\b/i);
  const sponsorshipMatch = withoutChannelLead.match(
    /\b(?:previous|past)\s+sponsorships?\s+by\s+(.+?)(?:\s+suggest|\s+indicate|,|\.|$)/i,
  );
  const subscriberMatch =
    withoutChannelLead.match(/\b(\d+(?:\.\d+)?\s*[kmb]?)\s+subscribers?\b/i) ??
    withoutChannelLead.match(/\bsubscriber base of\s+(\d+(?:\.\d+)?\s*[kmb]?)/i);
  const audienceMatch = withoutChannelLead.match(/\b(French|German|English|Spanish|Italian|Portuguese|Francophone|DACH|US|UK)[-\s]speaking audience\b/i);
  const dedicatedMatch = withoutChannelLead.match(/\b(?:fully\s+)?dedicated to\s+([^,.]+?)(?:\s+content)?(?:,|\.|$)/i);

  if (sponsorshipMatch?.[1]) {
    return `Past sponsors: ${sponsorshipMatch[1].replace(/\s+and\s+/i, ", ")}`;
  }

  if (weeklyMatch?.[1]) {
    return `Publishes ${weeklyMatch[1].toLowerCase()}`;
  }

  if (subscriberMatch?.[1]) {
    return `${subscriberMatch[1].replace(/\s+/g, "")} subscribers`;
  }

  if (audienceMatch?.[0]) {
    return toTitleCaseStart(audienceMatch[0]);
  }

  if (dedicatedMatch?.[1]) {
    return `Dedicated to ${dedicatedMatch[1].trim()}`;
  }

  const firstClause = withoutChannelLead.split(/[.;]/)[0]?.split(/,\s+(?:matching|consistent|indicating|which|fitting|supporting|allowing)\b/i)[0]?.trim();
  const compact = firstClause || withoutChannelLead;

  if (compact.length <= 80) {
    return toTitleCaseStart(compact);
  }

  const cutoff = compact.lastIndexOf(" ", 77);
  return `${toTitleCaseStart(compact.slice(0, cutoff > 30 ? cutoff : 77).trimEnd())}...`;
}

function getCompactFitReasons(items: string[] | null): string[] {
  return (items ?? []).map(compactFitReason).filter(Boolean);
}

function renderAssessmentList(title: string, items: string[]) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="run-detail__assessment-group run-detail__assessment-group--positive">
      <h5>{title}</h5>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function renderAssessment(assessment: RunChannelAssessmentItem | undefined) {
  if (!assessment) {
    return (
      <section className="run-detail__assessment run-detail__assessment--unavailable">
        <h4>Mini fit assessment</h4>
        <p>No Mini assessment was generated for this channel.</p>
      </section>
    );
  }

  if (assessment.status === "queued" || assessment.status === "running") {
    return (
      <section className="run-detail__assessment run-detail__assessment--pending">
        <div className="run-detail__assessment-heading">
          <h4>Mini fit assessment</h4>
          <StatusPill status={assessment.status} />
        </div>
        <p>Mini is reviewing this channel against the campaign brief.</p>
      </section>
    );
  }

  if (assessment.status === "failed") {
    return (
      <section className="run-detail__assessment run-detail__assessment--failed">
        <div className="run-detail__assessment-heading">
          <h4>Mini fit assessment</h4>
          <StatusPill status="failed" />
        </div>
        <p>{assessment.lastError || "Mini could not complete the fit assessment for this channel."}</p>
      </section>
    );
  }

  const fitScore = assessment.fitScore === null
    ? null
    : getFitScorePresentation(assessment.fitScore);
  const fitReasons = getCompactFitReasons(assessment.fitReasons);

  return (
    <section className="run-detail__assessment run-detail__assessment--completed">
      <div className="run-detail__assessment-heading">
        <h4>Mini fit assessment</h4>
        {fitScore ? (
          <strong className={`run-detail__fit-score run-detail__fit-score--${fitScore.tone}`}>
            {fitScore.label}
          </strong>
        ) : null}
      </div>
      <div className="run-detail__assessment-grid">
        {renderAssessmentList("Why it fits", fitReasons)}
      </div>
      {fitReasons.length === 0 ? (
        <p>No written rationale was returned for this assessment.</p>
      ) : null}
    </section>
  );
}

function renderResultCard(
  runId: string,
  runStatus: RunStatusResponse["status"],
  result: RunResultItem,
  assessment: RunChannelAssessmentItem | undefined,
) {
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
        {renderAssessment(assessment)}
        <RunResultRating
          disabled={runStatus !== "completed"}
          initialRating={result.rating ?? null}
          resultId={result.id}
          runId={runId}
        />
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
          <p className="run-detail__eyebrow">Scouting run</p>
          <h2 id="run-detail-heading">{run.name}</h2>
          <p className="run-detail__query">
            {getRunQueryLabel(run.query)}: {run.query}
          </p>
          <div className="run-detail__status-row">
            <StatusPill className={`run-detail__status run-detail__status--${run.status}`} status={run.status} />
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
          <h3 id="run-detail-job-feedback-heading">{jobFeedback.title}</h3>
          <p>{jobFeedback.summary}</p>
          <p>{jobFeedback.nextStep}</p>
          {jobFeedback.autoRefresh ? (
            <p className="run-detail__job-feedback-note">
              This page refreshes automatically while the run is in progress.
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
            <h2 id="run-detail-results-heading">Matched creators</h2>
            <p>
              Ranked matches for this run. Rate each creator, then send the list to Google Sheets.
            </p>
          </div>
          <div className="run-detail__panel-actions">
            <button className="run-detail__button run-detail__button--secondary" onClick={onRetry} type="button">
              Refresh now
            </button>
            {run.status === "completed" && run.results.length > 0 ? (
              <Link
                className="run-detail__button"
                href={getExportPreviewHref(run.id)}
              >
                Export to Google Sheets
              </Link>
            ) : null}
          </div>
        </header>

        {run.results.length > 0 ? (
          <ul className="run-detail__results-list">
            {run.results.map((result) =>
              renderResultCard(
                run.id,
                run.status,
                result,
                run.assessments.find((assessment) => assessment.channelId === result.channelId),
              ),
            )}
          </ul>
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
