"use client";

import type {
  ChannelAdvancedReportStatus,
  ChannelDetail,
  ChannelEnrichmentDetail,
  ChannelEnrichmentStatus,
  ChannelEstimatedPrice,
} from "@scouting-platform/contracts";
import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import {
  ApiRequestError,
  fetchChannelDetail,
  requestChannelEnrichment,
} from "../../lib/channels-api";
import { AdminChannelManualEditPanel } from "./admin-channel-manual-edit-panel";

type ChannelDetailShellProps = Readonly<{
  channelId: string;
  canManageManualEdits?: boolean;
}>;

type ChannelDetailRequestState =
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
      data: ChannelDetail;
      error: null;
    };

type ChannelEnrichmentActionState = {
  type: "idle" | "submitting" | "success" | "error";
  message: string;
};

type ChannelDetailShellViewProps = ChannelDetailShellProps & {
  requestState: ChannelDetailRequestState;
  enrichmentActionState: ChannelEnrichmentActionState;
  onRetry: () => void;
  onRequestEnrichment: () => void | Promise<void>;
  onChannelUpdated?: (channel: ChannelDetail) => void;
};

const INITIAL_REQUEST_STATE: ChannelDetailRequestState = {
  status: "loading",
  data: null,
  error: null,
};

const NOT_FOUND_REQUEST_STATE: ChannelDetailRequestState = {
  status: "notFound",
  data: null,
  error: null,
};

const IDLE_ENRICHMENT_ACTION_STATE: ChannelEnrichmentActionState = {
  type: "idle",
  message: "",
};

const EMPTY_VALUE = "Not available";

export const ENRICHMENT_STATUS_POLL_INTERVAL_MS = 3000;

function formatIsoTimestamp(value: string | null): string {
  if (!value) {
    return EMPTY_VALUE;
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);

  if (!match) {
    return value;
  }

  return `${match[1]} ${match[2]} UTC`;
}

function titleCase(value: string): string {
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

function getEnrichmentStatusLabel(status: ChannelEnrichmentStatus): string {
  if (status === "completed") {
    return "Ready";
  }

  return titleCase(status);
}

function getAdvancedReportStatusLabel(status: ChannelAdvancedReportStatus): string {
  return titleCase(status);
}

function getChannelHandle(channel: Pick<ChannelDetail, "handle">): string {
  return channel.handle?.trim() || "No public handle";
}

function getChannelDescription(channel: Pick<ChannelDetail, "description">): string {
  return channel.description?.trim() || "No channel description has been captured yet.";
}

function getIdentityFallback(title: string): string {
  return title.trim().charAt(0).toUpperCase() || "?";
}

function formatPercent(value: number): string {
  const normalized = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  return `${normalized.replace(/\.0$/, "")}%`;
}

function formatConfidence(value: number | null): string {
  if (value === null) {
    return EMPTY_VALUE;
  }

  return formatPercent(value * 100);
}

function formatEstimatedPrice(value: ChannelEstimatedPrice | null): string {
  if (!value) {
    return EMPTY_VALUE;
  }

  const prefix = value.currencyCode ? `${value.currencyCode} ` : "";

  if (value.min !== null && value.max !== null) {
    return `${prefix}${value.min}-${value.max}`;
  }

  if (value.min !== null) {
    return `${prefix}${value.min}+`;
  }

  if (value.max !== null) {
    return `Up to ${prefix}${value.max}`.trim();
  }

  return EMPTY_VALUE;
}

function formatInterestScore(value: number | null): string {
  if (value === null) {
    return "Score unavailable";
  }

  return value.toFixed(2);
}

function getLastCompletedReportSummary(channel: ChannelDetail): string {
  const lastCompletedReport = channel.advancedReport.lastCompletedReport;

  if (!lastCompletedReport) {
    return "No completed advanced reports yet.";
  }

  if (lastCompletedReport.withinFreshWindow) {
    return `Last completed report is fresh (${lastCompletedReport.ageDays} days old).`;
  }

  return `Last completed report is outside the 120-day review window (${lastCompletedReport.ageDays} days old).`;
}

function hasAudienceInsights(channel: ChannelDetail): boolean {
  return (
    channel.insights.audienceCountries.length > 0 ||
    channel.insights.audienceGenderAge.length > 0 ||
    channel.insights.audienceInterests.length > 0 ||
    channel.insights.brandMentions.length > 0 ||
    channel.insights.estimatedPrice !== null
  );
}

export function shouldPollEnrichmentStatus(status: ChannelEnrichmentStatus): boolean {
  return status === "queued" || status === "running";
}

function hasVisibleEnrichmentResult(
  enrichment: Pick<
    ChannelEnrichmentDetail,
    "summary" | "topics" | "brandFitNotes" | "confidence"
  >,
): boolean {
  return (
    (enrichment.summary?.trim().length ?? 0) > 0 ||
    (enrichment.topics?.length ?? 0) > 0 ||
    (enrichment.brandFitNotes?.trim().length ?? 0) > 0 ||
    enrichment.confidence !== null
  );
}

export function getEnrichmentActionLabel(status: ChannelEnrichmentStatus): string {
  if (status === "missing") {
    return "Enrich now";
  }

  if (status === "failed") {
    return "Retry enrichment";
  }

  if (status === "queued") {
    return "Enrichment queued";
  }

  if (status === "running") {
    return "Enrichment running";
  }

  return "Refresh enrichment";
}

function getEnrichmentFeedbackTitle(status: ChannelEnrichmentStatus): string {
  if (status === "missing") {
    return "No enrichment requested";
  }

  if (status === "queued") {
    return "Refresh queued";
  }

  if (status === "running") {
    return "Refresh running";
  }

  if (status === "failed") {
    return "Refresh failed";
  }

  if (status === "stale") {
    return "Refresh recommended";
  }

  return "Latest enrichment ready";
}

export function getEnrichmentStatusMessage(
  enrichment: Pick<
    ChannelEnrichmentDetail,
    "status" | "lastError" | "summary" | "topics" | "brandFitNotes" | "confidence"
  >,
): string {
  const hasRetainedResult = hasVisibleEnrichmentResult(enrichment);

  if (enrichment.status === "missing") {
    return "No enrichment has been requested yet. Queue one when you want a generated summary, topics, and brand fit notes.";
  }

  if (enrichment.status === "queued") {
    return hasRetainedResult
      ? "Enrichment is queued. This page refreshes automatically while the worker waits to start, and the previous result stays visible below until the refresh finishes."
      : "Enrichment is queued. This page refreshes automatically while the worker waits to start.";
  }

  if (enrichment.status === "running") {
    return hasRetainedResult
      ? "Enrichment is running in the background. This page refreshes automatically while processing continues, and the previous result stays visible below until the new result is stored."
      : "Enrichment is running in the background. This page refreshes automatically while processing continues.";
  }

  if (enrichment.status === "failed") {
    if (enrichment.lastError) {
      return hasRetainedResult
        ? `Last enrichment attempt failed: ${enrichment.lastError}. The last successful enrichment stays visible below while you decide whether to retry.`
        : `Last enrichment attempt failed: ${enrichment.lastError}`;
    }

    return hasRetainedResult
      ? "The last enrichment attempt failed before the worker could complete it. The last successful enrichment stays visible below while you decide whether to retry."
      : "The last enrichment attempt failed before the worker could complete it.";
  }

  if (enrichment.status === "stale") {
    return hasRetainedResult
      ? "This enrichment is stale because the channel changed or the freshness window expired. The last successful result stays visible below until you refresh it."
      : "This enrichment is stale because the channel changed or the freshness window expired. Refresh it to queue a new run.";
  }

  return hasRetainedResult
    ? "Enrichment is ready. The latest stored result is visible below."
    : "Enrichment is ready. Refresh it when the channel changes or you need a newer result.";
}

function getChannelDetailRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) {
      return "Your session does not allow access to this channel anymore. Sign in again and retry.";
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to load channel details. Please try again.";
}

function getEnrichmentRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) {
      return "Your session does not allow enrichment requests anymore. Sign in again and retry.";
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to request channel enrichment. Please try again.";
}

function getEnrichmentRequestSuccessMessage(
  status: ChannelEnrichmentStatus,
  hasRetainedResult: boolean,
): string {
  if (status === "running") {
    return hasRetainedResult
      ? "Enrichment is already running. This page refreshes automatically while the worker finishes, and the current result stays visible below."
      : "Enrichment is already running. This page refreshes automatically while the worker finishes.";
  }

  if (status === "completed") {
    return hasRetainedResult
      ? "Enrichment is already ready. The current stored result remains visible below."
      : "Enrichment is already ready.";
  }

  return hasRetainedResult
    ? "Enrichment request recorded. This page refreshes automatically while the worker runs, and the current result stays visible below until the refresh completes."
    : "Enrichment request recorded. This page refreshes automatically while the worker runs.";
}

export function mergeChannelEnrichment(
  channel: ChannelDetail,
  enrichment: ChannelEnrichmentDetail,
): ChannelDetail {
  return {
    ...channel,
    enrichment: {
      ...enrichment,
      summary: enrichment.summary ?? channel.enrichment.summary,
      topics: enrichment.topics ?? channel.enrichment.topics,
      brandFitNotes: enrichment.brandFitNotes ?? channel.enrichment.brandFitNotes,
      confidence: enrichment.confidence ?? channel.enrichment.confidence,
    },
  };
}

function renderReadyState(
  channel: ChannelDetail,
  options: {
    canManageManualEdits: boolean;
    enrichmentActionState: ChannelEnrichmentActionState;
    onRequestEnrichment: () => void | Promise<void>;
    onChannelUpdated?: (channel: ChannelDetail) => void;
  },
) {
  const isBusy =
    options.enrichmentActionState.type === "submitting" ||
    shouldPollEnrichmentStatus(channel.enrichment.status);
  const actionStatus = options.enrichmentActionState;

  return (
    <>
      <section aria-labelledby="channel-detail-shell-heading" className="channel-detail-shell__hero">
        <div className="channel-detail-shell__identity">
          {channel.thumbnailUrl ? (
            <Image
              alt={`${channel.title} thumbnail`}
              className="channel-detail-shell__thumbnail"
              height={96}
              src={channel.thumbnailUrl}
              width={96}
            />
          ) : (
            <div
              aria-hidden="true"
              className="channel-detail-shell__thumbnail channel-detail-shell__thumbnail--fallback"
            >
              {getIdentityFallback(channel.title)}
            </div>
          )}

          <div className="channel-detail-shell__identity-copy">
            <p className="channel-detail-shell__eyebrow">Catalog channel</p>
            <h2 id="channel-detail-shell-heading">{channel.title}</h2>
            <p className="channel-detail-shell__handle">{getChannelHandle(channel)}</p>
            <p className="channel-detail-shell__description">{getChannelDescription(channel)}</p>

            <div className="channel-detail-shell__status-row">
              <span
                className={`channel-detail-shell__status channel-detail-shell__status--${channel.enrichment.status}`}
              >
                Enrichment: {getEnrichmentStatusLabel(channel.enrichment.status)}
              </span>
              <span
                className={`channel-detail-shell__status channel-detail-shell__status--${channel.advancedReport.status}`}
              >
                Advanced report: {getAdvancedReportStatusLabel(channel.advancedReport.status)}
              </span>
            </div>
          </div>
        </div>

        <dl className="channel-detail-shell__route-meta">
          <div>
            <dt>Catalog record ID</dt>
            <dd>
              <code>{channel.id}</code>
            </dd>
          </div>
          <div>
            <dt>YouTube channel ID</dt>
            <dd>
              <code>{channel.youtubeChannelId}</code>
            </dd>
          </div>
        </dl>
      </section>

      <div className="channel-detail-shell__grid">
        <section
          aria-labelledby="channel-detail-shell-catalog-metadata-heading"
          className="channel-detail-shell__panel"
        >
          <header>
            <h2 id="channel-detail-shell-catalog-metadata-heading">Catalog metadata</h2>
            <p>The detail page reflects the resolved catalog profile that the rest of the app reads.</p>
          </header>

          <dl className="channel-detail-shell__details">
            <div>
              <dt>Handle</dt>
              <dd>{getChannelHandle(channel)}</dd>
            </div>
            <div>
              <dt>Thumbnail</dt>
              <dd>{channel.thumbnailUrl ? "Available" : "Missing"}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatIsoTimestamp(channel.createdAt)}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatIsoTimestamp(channel.updatedAt)}</dd>
            </div>
          </dl>
        </section>

        <section
          aria-labelledby="channel-detail-shell-enrichment-heading"
          className="channel-detail-shell__panel"
        >
          <header>
            <h2 id="channel-detail-shell-enrichment-heading">Enrichment</h2>
            <p>Request or refresh LLM enrichment here and keep the current result visible while new work runs.</p>
          </header>

          <div
            className={`channel-detail-shell__job-feedback channel-detail-shell__job-feedback--${channel.enrichment.status}`}
          >
            <h3 className="channel-detail-shell__subheading">
              {getEnrichmentFeedbackTitle(channel.enrichment.status)}
            </h3>
            <p className="channel-detail-shell__body-copy">
              {getEnrichmentStatusMessage(channel.enrichment)}
            </p>
          </div>

          <div className="channel-detail-shell__actions">
            <button
              className="channel-detail-shell__button"
              disabled={isBusy}
              onClick={() => {
                void options.onRequestEnrichment();
              }}
              type="button"
            >
              {options.enrichmentActionState.type === "submitting"
                ? "Requesting..."
                : getEnrichmentActionLabel(channel.enrichment.status)}
            </button>
          </div>

          {actionStatus.message ? (
            <div className="channel-detail-shell__request-feedback">
              <p
                className={`channel-detail-shell__action-status channel-detail-shell__action-status--${actionStatus.type}`}
                role={actionStatus.type === "error" ? "alert" : "status"}
              >
                {actionStatus.message}
              </p>
            </div>
          ) : null}

          <dl className="channel-detail-shell__details">
            <div>
              <dt>Status</dt>
              <dd>{getEnrichmentStatusLabel(channel.enrichment.status)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatIsoTimestamp(channel.enrichment.updatedAt)}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{formatIsoTimestamp(channel.enrichment.completedAt)}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{formatConfidence(channel.enrichment.confidence)}</dd>
            </div>
            {channel.enrichment.lastError ? (
              <div>
                <dt>Last error</dt>
                <dd>{channel.enrichment.lastError}</dd>
              </div>
            ) : null}
          </dl>

          <div className="channel-detail-shell__stack">
            <div>
              <h3 className="channel-detail-shell__subheading">Summary</h3>
              <p className="channel-detail-shell__body-copy">
                {channel.enrichment.summary ?? "No enrichment summary is available yet."}
              </p>
            </div>

            <div>
              <h3 className="channel-detail-shell__subheading">Topics</h3>
              {channel.enrichment.topics?.length ? (
                <ul className="channel-detail-shell__tag-list">
                  {channel.enrichment.topics.map((topic) => (
                    <li key={topic}>{topic}</li>
                  ))}
                </ul>
              ) : (
                <p className="channel-detail-shell__body-copy">No enrichment topics are available yet.</p>
              )}
            </div>

            <div>
              <h3 className="channel-detail-shell__subheading">Brand fit notes</h3>
              <p className="channel-detail-shell__body-copy">
                {channel.enrichment.brandFitNotes ?? "No brand fit notes are available yet."}
              </p>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="channel-detail-shell-advanced-report-heading"
          className="channel-detail-shell__panel"
        >
          <header>
            <h2 id="channel-detail-shell-advanced-report-heading">Advanced report</h2>
            <p>Status and freshness are visible now so later approval work has the right baseline.</p>
          </header>

          <dl className="channel-detail-shell__details">
            <div>
              <dt>Status</dt>
              <dd>{getAdvancedReportStatusLabel(channel.advancedReport.status)}</dd>
            </div>
            <div>
              <dt>Active request ID</dt>
              <dd>{channel.advancedReport.requestId ?? EMPTY_VALUE}</dd>
            </div>
            <div>
              <dt>Requested</dt>
              <dd>{formatIsoTimestamp(channel.advancedReport.requestedAt)}</dd>
            </div>
            <div>
              <dt>Reviewed</dt>
              <dd>{formatIsoTimestamp(channel.advancedReport.reviewedAt)}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{formatIsoTimestamp(channel.advancedReport.completedAt)}</dd>
            </div>
            <div>
              <dt>Last error</dt>
              <dd>{channel.advancedReport.lastError ?? EMPTY_VALUE}</dd>
            </div>
          </dl>

          <div className="channel-detail-shell__stack">
            <div>
              <h3 className="channel-detail-shell__subheading">Decision note</h3>
              <p className="channel-detail-shell__body-copy">
                {channel.advancedReport.decisionNote ?? "No approval decision has been recorded yet."}
              </p>
            </div>

            <div>
              <h3 className="channel-detail-shell__subheading">Freshness</h3>
              <p className="channel-detail-shell__body-copy">{getLastCompletedReportSummary(channel)}</p>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="channel-detail-shell-insights-heading"
          className="channel-detail-shell__panel"
        >
          <header>
            <h2 id="channel-detail-shell-insights-heading">Audience insights</h2>
            <p>Available HypeAuditor-derived audience and commercial context appears here when present.</p>
          </header>

          {hasAudienceInsights(channel) ? (
            <div className="channel-detail-shell__insights-grid">
              <div className="channel-detail-shell__insight-block">
                <h3 className="channel-detail-shell__subheading">Audience countries</h3>
                {channel.insights.audienceCountries.length ? (
                  <ul className="channel-detail-shell__list">
                    {channel.insights.audienceCountries.map((country) => (
                      <li key={`${country.countryCode}-${country.countryName}`}>
                        <span>{country.countryName}</span>
                        <span>{formatPercent(country.percentage)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="channel-detail-shell__body-copy">No audience country data yet.</p>
                )}
              </div>

              <div className="channel-detail-shell__insight-block">
                <h3 className="channel-detail-shell__subheading">Gender and age</h3>
                {channel.insights.audienceGenderAge.length ? (
                  <ul className="channel-detail-shell__list">
                    {channel.insights.audienceGenderAge.map((segment) => (
                      <li key={`${segment.gender}-${segment.ageRange}`}>
                        <span>{`${segment.gender}, ${segment.ageRange}`}</span>
                        <span>{formatPercent(segment.percentage)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="channel-detail-shell__body-copy">No gender or age data yet.</p>
                )}
              </div>

              <div className="channel-detail-shell__insight-block">
                <h3 className="channel-detail-shell__subheading">Interests</h3>
                {channel.insights.audienceInterests.length ? (
                  <ul className="channel-detail-shell__list">
                    {channel.insights.audienceInterests.map((interest) => (
                      <li key={interest.label}>
                        <span>{interest.label}</span>
                        <span>{formatInterestScore(interest.score)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="channel-detail-shell__body-copy">No audience interest data yet.</p>
                )}
              </div>

              <div className="channel-detail-shell__insight-block">
                <h3 className="channel-detail-shell__subheading">Commercial signals</h3>
                <dl className="channel-detail-shell__details">
                  <div>
                    <dt>Estimated price</dt>
                    <dd>{formatEstimatedPrice(channel.insights.estimatedPrice)}</dd>
                  </div>
                </dl>

                <h3 className="channel-detail-shell__subheading">Brand mentions</h3>
                {channel.insights.brandMentions.length ? (
                  <ul className="channel-detail-shell__tag-list">
                    {channel.insights.brandMentions.map((brand) => (
                      <li key={brand.brandName}>{brand.brandName}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="channel-detail-shell__body-copy">No brand mentions are available yet.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="channel-detail-shell__body-copy">
              No audience insight data is available for this channel yet.
            </p>
          )}
        </section>

        {options.canManageManualEdits && options.onChannelUpdated ? (
          <AdminChannelManualEditPanel channel={channel} onChannelUpdated={options.onChannelUpdated} />
        ) : null}
      </div>
    </>
  );
}

export function ChannelDetailShellView({
  canManageManualEdits,
  channelId,
  enrichmentActionState,
  onChannelUpdated,
  onRequestEnrichment,
  onRetry,
  requestState,
}: ChannelDetailShellViewProps) {
  return (
    <div className="channel-detail-shell">
      <Link className="channel-detail-shell__back-link" href="/catalog">
        Back to catalog
      </Link>

      {requestState.status === "loading" ? (
        <p className="channel-detail-shell__feedback channel-detail-shell__feedback--loading">
          Loading channel details...
        </p>
      ) : null}

      {requestState.status === "error" ? (
        <div className="channel-detail-shell__feedback channel-detail-shell__feedback--error" role="alert">
          <p>{requestState.error}</p>
          <button className="channel-detail-shell__button" onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : null}

      {requestState.status === "notFound" ? (
        <section className="channel-detail-shell__empty-state">
          <h2>Channel not found</h2>
          <p>
            We could not find a catalog record for <code>{channelId}</code>.
          </p>
        </section>
      ) : null}

      {requestState.status === "ready"
        ? renderReadyState(requestState.data, {
            canManageManualEdits: canManageManualEdits ?? false,
            enrichmentActionState,
            onRequestEnrichment,
            ...(onChannelUpdated ? { onChannelUpdated } : {}),
          })
        : null}
    </div>
  );
}

export function ChannelDetailShell({ channelId, canManageManualEdits }: ChannelDetailShellProps) {
  const isManualEditEnabled = canManageManualEdits ?? false;
  const [requestState, setRequestState] = useState<ChannelDetailRequestState>(INITIAL_REQUEST_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const [enrichmentActionState, setEnrichmentActionState] = useState<ChannelEnrichmentActionState>(
    IDLE_ENRICHMENT_ACTION_STATE,
  );

  useEffect(() => {
    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function loadChannel(polling = false) {
      if (!polling && requestState.status !== "ready") {
        setRequestState(INITIAL_REQUEST_STATE);
      }

      try {
        const channel = await fetchChannelDetail(channelId, abortController.signal);

        if (didCancel) {
          return;
        }

        setRequestState({
          status: "ready",
          data: channel,
          error: null,
        });

        if (shouldPollEnrichmentStatus(channel.enrichment.status)) {
          timeoutId = setTimeout(() => {
            void loadChannel(true);
          }, ENRICHMENT_STATUS_POLL_INTERVAL_MS);
        }
      } catch (error: unknown) {
        if (didCancel || (error instanceof Error && error.name === "AbortError")) {
          return;
        }

        if (error instanceof ApiRequestError && error.status === 404) {
          setRequestState(NOT_FOUND_REQUEST_STATE);
          return;
        }

        if (polling && requestState.status === "ready") {
          return;
        }

        setRequestState({
          status: "error",
          data: null,
          error: getChannelDetailRequestErrorMessage(error),
        });
      }
    }

    void loadChannel();

    return () => {
      didCancel = true;
      abortController.abort();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [channelId, reloadToken]);

  useEffect(() => {
    setEnrichmentActionState(IDLE_ENRICHMENT_ACTION_STATE);
  }, [channelId]);

  async function handleRequestEnrichment(): Promise<void> {
    if (requestState.status !== "ready") {
      return;
    }

    if (shouldPollEnrichmentStatus(requestState.data.enrichment.status)) {
      return;
    }

    const hadVisibleEnrichment = hasVisibleEnrichmentResult(requestState.data.enrichment);

    setEnrichmentActionState({
      type: "submitting",
      message: "",
    });

    try {
      const response = await requestChannelEnrichment(channelId);

      setRequestState((current) => {
        if (current.status !== "ready") {
          return current;
        }

        return {
          status: "ready",
          data: mergeChannelEnrichment(current.data, response.enrichment),
          error: null,
        };
      });
      setEnrichmentActionState({
        type: "success",
        message: getEnrichmentRequestSuccessMessage(
          response.enrichment.status,
          hadVisibleEnrichment || hasVisibleEnrichmentResult(response.enrichment),
        ),
      });
      setReloadToken((currentValue) => currentValue + 1);
    } catch (error) {
      setEnrichmentActionState({
        type: "error",
        message: getEnrichmentRequestErrorMessage(error),
      });
    }
  }

  return (
    <ChannelDetailShellView
      canManageManualEdits={isManualEditEnabled}
      channelId={channelId}
      enrichmentActionState={enrichmentActionState}
      onChannelUpdated={(channel) => {
        setRequestState((current) => {
          if (current.status !== "ready") {
            return current;
          }

          return {
            status: "ready",
            data: channel,
            error: null,
          };
        });
      }}
      onRequestEnrichment={handleRequestEnrichment}
      onRetry={() => {
        setReloadToken((currentValue) => currentValue + 1);
      }}
      requestState={requestState}
    />
  );
}
