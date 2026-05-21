"use client";

import type {
  ChannelDetail,
  ChannelEnrichmentDetail,
  ChannelEnrichmentStatus,
} from "@scouting-platform/contracts";
import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";

import {
  ApiRequestError,
  fetchChannelDetail,
  requestChannelEnrichment,
} from "../../lib/channels-api";

type ChannelDetailShellProps = Readonly<{
  channelId: string;
  canManageManualEdits?: boolean;
  initialData?: ChannelDetail | null;
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

type ChannelRequestActionState = {
  type: "idle" | "submitting" | "success" | "error";
  message: string;
};

type ChannelEnrichmentActionState = ChannelRequestActionState;

type ChannelDetailShellViewProps = {
  channelId: string;
  requestState: ChannelDetailRequestState;
  enrichmentActionState: ChannelEnrichmentActionState;
  onRetry: () => void;
  onRequestEnrichment: () => void | Promise<void>;
};

type StatusPopoverTagProps = Readonly<{
  title: string;
  summary: string;
  statusClassName: string;
  body: string;
  actionLabel: string;
  actionBusyLabel?: string;
  disabled: boolean;
  actionState: ChannelRequestActionState;
  onAction: () => void;
}>;

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

const IDLE_REQUEST_ACTION_STATE: ChannelRequestActionState = {
  type: "idle",
  message: "",
};

const IDLE_ENRICHMENT_ACTION_STATE: ChannelEnrichmentActionState = IDLE_REQUEST_ACTION_STATE;

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

function getChannelHandle(channel: Pick<ChannelDetail, "handle">): string {
  return channel.handle?.trim() || "No public handle";
}

function getChannelDescription(channel: Pick<ChannelDetail, "description">): string {
  return channel.description?.trim() || "No channel description has been captured yet.";
}

function getIdentityFallback(title: string): string {
  return title.trim().charAt(0).toUpperCase() || "?";
}

function formatMetric(value: string | null | undefined): string {
  if (!value) {
    return EMPTY_VALUE;
  }

  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue)) {
    return value;
  }

  return new Intl.NumberFormat("en-US").format(parsedValue);
}

function formatEngagementRate(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return EMPTY_VALUE;
  }

  const normalized = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  return `${normalized.replace(/\.0$/, "")}%`;
}

function formatConfidence(value: number | null): string {
  if (value === null) {
    return EMPTY_VALUE;
  }

  return formatEngagementRate(value * 100);
}

function resolveYoutubeUrl(channel: Pick<ChannelDetail, "youtubeUrl" | "youtubeChannelId">): string {
  const explicitUrl = channel.youtubeUrl?.trim();

  if (explicitUrl) {
    return explicitUrl;
  }

  return `https://www.youtube.com/channel/${channel.youtubeChannelId}`;
}

function resolveSocialMediaUrl(
  channel: Pick<ChannelDetail, "socialMediaLink" | "youtubeUrl" | "youtubeChannelId">,
): string {
  const explicitSocialMediaUrl = channel.socialMediaLink?.trim();

  if (explicitSocialMediaUrl) {
    return explicitSocialMediaUrl;
  }

  return resolveYoutubeUrl(channel);
}

function formatPlatforms(platforms: readonly string[] | null | undefined): string {
  if (!platforms || platforms.length === 0) {
    return EMPTY_VALUE;
  }

  return platforms.join(", ");
}

function hasVisibleEnrichmentResult(
  enrichment: Pick<
    ChannelEnrichmentDetail,
    "summary" | "topics" | "brandFitNotes" | "confidence" | "structuredProfile"
  >,
): boolean {
  return (
    (enrichment.summary?.trim().length ?? 0) > 0 ||
    (enrichment.topics?.length ?? 0) > 0 ||
    (enrichment.brandFitNotes?.trim().length ?? 0) > 0 ||
    enrichment.confidence !== null ||
    enrichment.structuredProfile !== null
  );
}

function shouldPollEnrichmentStatus(status: ChannelEnrichmentStatus): boolean {
  return status === "queued" || status === "running";
}

function shouldPollChannelDetailStatus(channel: Pick<ChannelDetail, "enrichment">): boolean {
  return shouldPollEnrichmentStatus(channel.enrichment.status);
}

function getEnrichmentActionLabel(status: ChannelEnrichmentStatus): string {
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

function getEnrichmentStatusMessage(
  enrichment: Pick<
    ChannelEnrichmentDetail,
    "status" | "lastError" | "summary" | "topics" | "brandFitNotes" | "confidence" | "structuredProfile"
  >,
): string {
  const hasRetainedResult = hasVisibleEnrichmentResult(enrichment);

  if (enrichment.status === "missing") {
    return "No enrichment has been requested yet. Queue one when you want a generated summary and profile classification details.";
  }

  if (enrichment.status === "queued") {
    return hasRetainedResult
      ? "Enrichment is queued. This page refreshes automatically while waiting, and the previous result stays visible below until the refresh finishes."
      : "Enrichment is queued. This page refreshes automatically while waiting.";
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

function renderEnrichmentTopics(topics: readonly string[] | null): React.JSX.Element {
  if (!topics?.length) {
    return <p className="channel-detail-shell__body-copy">No enrichment topics are available yet.</p>;
  }

  return (
    <ul className="channel-detail-shell__tag-list">
      {topics.map((topic) => (
        <li key={topic}>{topic}</li>
      ))}
    </ul>
  );
}

function mergeChannelEnrichment(
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
      structuredProfile: enrichment.structuredProfile ?? channel.enrichment.structuredProfile,
    },
  };
}

function StatusPopoverTag({
  title,
  summary,
  statusClassName,
  body,
  actionLabel,
  actionBusyLabel = "Requesting...",
  disabled,
  actionState,
  onAction,
}: StatusPopoverTagProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function isOutsidePopover(target: EventTarget | null): boolean {
      return target instanceof Node && !rootRef.current?.contains(target);
    }

    function handlePointerDown(event: MouseEvent | PointerEvent | TouchEvent): void {
      if (isOutsidePopover(event.target)) {
        setIsOpen(false);
      }
    }

    function handleFocusIn(event: FocusEvent): void {
      if (isOutsidePopover(event.target)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (!isOpen) {
      return;
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="channel-detail-shell__status-popover" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        className={statusClassName}
        onClick={() => {
          setIsOpen((current) => !current);
        }}
        type="button"
      >
        {summary}
      </button>

      {isOpen ? (
        <div className="channel-detail-shell__status-popover-panel">
          <h3 className="channel-detail-shell__subheading">{title}</h3>
          <p className="channel-detail-shell__body-copy">{body}</p>
          <button
            className="channel-detail-shell__button channel-detail-shell__button--tag"
            disabled={disabled}
            onClick={() => {
              onAction();
              setIsOpen(false);
            }}
            type="button"
          >
            {actionState.type === "submitting" ? actionBusyLabel : actionLabel}
          </button>
          {actionState.message ? (
            <p
              className={`channel-detail-shell__action-status channel-detail-shell__action-status--${actionState.type} channel-detail-shell__action-status--inline`}
              role={actionState.type === "error" ? "alert" : "status"}
            >
              {actionState.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function renderReadyState(
  channel: ChannelDetail,
  options: {
    enrichmentActionState: ChannelEnrichmentActionState;
    onRequestEnrichment: () => void | Promise<void>;
  },
) {
  const enrichmentActionStatus = options.enrichmentActionState;
  const isEnrichmentBusy =
    options.enrichmentActionState.type === "submitting" ||
    shouldPollEnrichmentStatus(channel.enrichment.status);
  const youtubeUrl = resolveYoutubeUrl(channel);
  const socialMediaUrl = resolveSocialMediaUrl(channel);
  const handleLabel = getChannelHandle(channel);
  const descriptionText = getChannelDescription(channel);

  return (
    <>
      <section aria-labelledby="channel-detail-shell-heading" className="creator-profile__hero channel-detail-shell__hero">
        <div className="creator-profile__hero-main">
          <div className="creator-profile__avatar-wrap">
            {channel.thumbnailUrl ? (
              <Image
                alt={`${channel.title} thumbnail`}
                className="creator-profile__avatar channel-detail-shell__thumbnail"
                height={120}
                src={channel.thumbnailUrl}
                width={120}
              />
            ) : (
              <div
                aria-hidden="true"
                className="creator-profile__avatar creator-profile__avatar--fallback channel-detail-shell__thumbnail channel-detail-shell__thumbnail--fallback"
              >
                {getIdentityFallback(channel.title)}
              </div>
            )}
          </div>

          <div className="creator-profile__identity channel-detail-shell__identity-copy">
            <p className="creator-profile__eyebrow channel-detail-shell__eyebrow">Catalog influencer profile</p>
            <h2 className="creator-profile__title" id="channel-detail-shell-heading">{channel.title}</h2>
            <p className="creator-profile__handle channel-detail-shell__handle">{handleLabel}</p>

            <div className="creator-profile__chips">
              {channel.countryRegion ? (
                <span className="creator-chip">
                  <span aria-hidden="true" className="creator-chip__icon">◎</span>
                  {channel.countryRegion}
                </span>
              ) : null}
              {channel.contentLanguage ? (
                <span className="creator-chip">
                  <span aria-hidden="true" className="creator-chip__icon">¶</span>
                  {channel.contentLanguage}
                </span>
              ) : null}
              {channel.influencerVertical ? (
                <span className="creator-chip creator-chip--accent">{channel.influencerVertical}</span>
              ) : null}
              {channel.influencerType ? (
                <span className="creator-chip">{channel.influencerType}</span>
              ) : null}
              {channel.platforms && channel.platforms.length > 0 ? (
                <span className="creator-chip creator-chip--muted">
                  Platforms: {formatPlatforms(channel.platforms)}
                </span>
              ) : null}
            </div>

            <div className="creator-profile__hero-actions channel-detail-shell__hero-controls">
              <a className="workspace-button creator-profile__primary-action" href={youtubeUrl} rel="noreferrer" target="_blank">
                Open on YouTube
              </a>
              <a
                className="workspace-button workspace-button--secondary"
                href={socialMediaUrl}
                rel="noreferrer"
                target="_blank"
              >
                View socials
              </a>
              <div className="channel-detail-shell__status-row">
                <StatusPopoverTag
                  actionLabel={getEnrichmentActionLabel(channel.enrichment.status)}
                  actionState={enrichmentActionStatus}
                  body={getEnrichmentStatusMessage(channel.enrichment)}
                  disabled={isEnrichmentBusy}
                  onAction={() => {
                    void options.onRequestEnrichment();
                  }}
                  statusClassName={`channel-detail-shell__status channel-detail-shell__status--${channel.enrichment.status}`}
                  summary={`Enrichment: ${getEnrichmentStatusLabel(channel.enrichment.status)}`}
                  title="Enrichment"
                />
              </div>
            </div>
          </div>
        </div>

        <dl className="creator-profile__hero-meta channel-detail-shell__route-meta">
          <article className="creator-meta-card">
            <dt>Catalog record ID</dt>
            <dd>
              <code>{channel.id}</code>
            </dd>
          </article>
          <article className="creator-meta-card">
            <dt>YouTube channel ID</dt>
            <dd>
              <code>{channel.youtubeChannelId}</code>
            </dd>
          </article>
          <article className="creator-meta-card">
            <dt>Last updated</dt>
            <dd>{formatIsoTimestamp(channel.updatedAt)}</dd>
          </article>
        </dl>
      </section>

      <section aria-label="Creator headline metrics" className="creator-profile__kpis">
        <article className="creator-kpi">
          <p className="creator-kpi__label">YouTube Followers</p>
          <p className="creator-kpi__value">{formatMetric(channel.youtubeFollowers)}</p>
          <p className="creator-kpi__hint">Subscribers</p>
        </article>
        <article className="creator-kpi creator-kpi--accent">
          <p className="creator-kpi__label">YouTube Engagement Rate</p>
          <p className="creator-kpi__value">{formatEngagementRate(channel.youtubeEngagementRate)}</p>
          <p className="creator-kpi__hint">Audience interaction</p>
        </article>
        <article className="creator-kpi">
          <p className="creator-kpi__label">YouTube Video Median Views</p>
          <p className="creator-kpi__value">{formatMetric(channel.youtubeVideoMedianViews)}</p>
          <p className="creator-kpi__hint">Per long-form</p>
        </article>
        <article className="creator-kpi">
          <p className="creator-kpi__label">YouTube Shorts Median Views</p>
          <p className="creator-kpi__value">{formatMetric(channel.youtubeShortsMedianViews)}</p>
          <p className="creator-kpi__hint">Per Short</p>
        </article>
      </section>

      <section
        aria-labelledby="channel-detail-shell-profile-heading"
        className="creator-profile__body channel-detail-shell__panel"
      >
        <header className="creator-profile__body-header">
          <h2 id="channel-detail-shell-profile-heading">Creator profile</h2>
          <p>Catalog facts, performance metrics and enrichment intelligence in one place.</p>
        </header>

        <div className="creator-profile__layout">
          <div className="creator-profile__main">
            <article className="creator-card">
              <header className="creator-card__header">
                <h3 className="creator-card__title channel-detail-shell__subheading">About</h3>
              </header>
              <div className="creator-card__body">
                <dl className="creator-detail-list">
                  <div>
                    <dt>Description</dt>
                    <dd>{descriptionText}</dd>
                  </div>
                </dl>
              </div>
            </article>

            <article className="creator-card">
              <header className="creator-card__header">
                <h3 className="creator-card__title channel-detail-shell__subheading">Channel details</h3>
                <p className="creator-card__hint">Catalog facts captured for this creator.</p>
              </header>
              <div className="creator-card__body">
                <dl className="creator-detail-list channel-detail-shell__details">
                  <div>
                    <dt>Channel name/title</dt>
                    <dd>{channel.title}</dd>
                  </div>
                  <div>
                    <dt>YouTube handle</dt>
                    <dd>{handleLabel}</dd>
                  </div>
                  <div>
                    <dt>Country/Region</dt>
                    <dd>{channel.countryRegion ?? EMPTY_VALUE}</dd>
                  </div>
                  <div>
                    <dt>Content language</dt>
                    <dd>{channel.contentLanguage ?? EMPTY_VALUE}</dd>
                  </div>
                  <div>
                    <dt>Influencer type</dt>
                    <dd>{channel.influencerType ?? EMPTY_VALUE}</dd>
                  </div>
                  <div>
                    <dt>Influencer vertical</dt>
                    <dd>{channel.influencerVertical ?? EMPTY_VALUE}</dd>
                  </div>
                  <div>
                    <dt>Platforms</dt>
                    <dd>{formatPlatforms(channel.platforms)}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>
                      {channel.email ? (
                        <a className="catalog-table__link" href={`mailto:${channel.email}`}>{channel.email}</a>
                      ) : (
                        EMPTY_VALUE
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </article>

            <article className="creator-card creator-card--enrichment">
              <header className="creator-card__header creator-card__header--row">
                <div>
                  <p className="creator-card__eyebrow">AI Enrichment summary</p>
                  <h3 className="creator-card__title channel-detail-shell__subheading">Enrichment summary</h3>
                </div>
                <span className={`channel-detail-shell__status channel-detail-shell__status--${channel.enrichment.status} channel-detail-shell__status--inline`}>
                  Enrichment: {getEnrichmentStatusLabel(channel.enrichment.status)}
                </span>
              </header>
              <div className="creator-card__body creator-card__body--stack">
                <dl className="creator-detail-list creator-detail-list--inline channel-detail-shell__details">
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
                    <div className="creator-detail-list__full">
                      <dt>Last error</dt>
                      <dd>{channel.enrichment.lastError}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="creator-card__section">
                  <h4 className="creator-card__subheading channel-detail-shell__subheading">Summary</h4>
                  <p className="creator-card__copy channel-detail-shell__body-copy">
                    {channel.enrichment.summary ?? "No enrichment summary is available yet."}
                  </p>
                </div>
                <div className="creator-card__section">
                  <h4 className="creator-card__subheading channel-detail-shell__subheading">Topics</h4>
                  {renderEnrichmentTopics(channel.enrichment.topics)}
                </div>
              </div>
            </article>
          </div>

          <aside className="creator-profile__rail">
            <article className="creator-card creator-card--rail">
              <header className="creator-card__header">
                <h3 className="creator-card__title channel-detail-shell__subheading">Performance metrics</h3>
                <p className="creator-card__hint">Latest cached numbers for this creator.</p>
              </header>
              <div className="creator-card__body">
                <dl className="creator-detail-list channel-detail-shell__details">
                  <div>
                    <dt>YouTube Followers</dt>
                    <dd>{formatMetric(channel.youtubeFollowers)}</dd>
                  </div>
                  <div>
                    <dt>YouTube Engagement Rate</dt>
                    <dd>{formatEngagementRate(channel.youtubeEngagementRate)}</dd>
                  </div>
                  <div>
                    <dt>YouTube Video Median Views</dt>
                    <dd>{formatMetric(channel.youtubeVideoMedianViews)}</dd>
                  </div>
                  <div>
                    <dt>YouTube Shorts Median Views</dt>
                    <dd>{formatMetric(channel.youtubeShortsMedianViews)}</dd>
                  </div>
                </dl>
              </div>
            </article>

            <article className="creator-card creator-card--rail">
              <header className="creator-card__header">
                <h3 className="creator-card__title channel-detail-shell__subheading">Links & identifiers</h3>
              </header>
              <div className="creator-card__body">
                <dl className="creator-detail-list channel-detail-shell__details">
                  <div>
                    <dt>YouTube channel ID</dt>
                    <dd>
                      <code>{channel.youtubeChannelId}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>YouTube URL</dt>
                    <dd>
                      <a className="catalog-table__link" href={youtubeUrl} rel="noreferrer" target="_blank">
                        {youtubeUrl}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Social media URL</dt>
                    <dd>
                      <a className="catalog-table__link" href={socialMediaUrl} rel="noreferrer" target="_blank">
                        {socialMediaUrl}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Thumbnail</dt>
                    <dd>
                      {channel.thumbnailUrl ? (
                        <a className="catalog-table__link" href={channel.thumbnailUrl} rel="noreferrer" target="_blank">
                          Open thumbnail
                        </a>
                      ) : (
                        EMPTY_VALUE
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </article>
          </aside>
        </div>
      </section>
    </>
  );
}

export function ChannelDetailShellView({
  channelId,
  enrichmentActionState,
  onRequestEnrichment,
  onRetry,
  requestState,
}: ChannelDetailShellViewProps) {
  return (
    <div className="channel-detail-shell">
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
            enrichmentActionState,
            onRequestEnrichment,
          })
        : null}
    </div>
  );
}

export function ChannelDetailShell({
  channelId,
  initialData,
}: ChannelDetailShellProps) {
  const [requestState, setRequestState] = useState<ChannelDetailRequestState>(
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
  const reloadOriginChannelIdRef = useRef<string | null>(null);
  const [enrichmentActionState, setEnrichmentActionState] = useState<ChannelEnrichmentActionState>(
    IDLE_ENRICHMENT_ACTION_STATE,
  );

  useEffect(() => {
    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const canReuseInitialData = reloadToken === 0 && !!initialData;

    async function loadChannel(polling = false) {
      const isBackgroundRefresh =
        polling || (reloadToken > 0 && reloadOriginChannelIdRef.current === channelId);

      if (!isBackgroundRefresh && !canReuseInitialData) {
        setRequestState(INITIAL_REQUEST_STATE);
      }

      try {
        const channel =
          canReuseInitialData && !polling
            ? initialData
            : await fetchChannelDetail(channelId, abortController.signal);

        if (didCancel) {
          return;
        }

        if (!channel) {
          setRequestState(NOT_FOUND_REQUEST_STATE);
          return;
        }

        setRequestState({
          status: "ready",
          data: channel,
          error: null,
        });

        if (shouldPollChannelDetailStatus(channel)) {
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

        if (isBackgroundRefresh) {
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
  }, [channelId, initialData, reloadToken]);

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
      reloadOriginChannelIdRef.current = channelId;
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
      channelId={channelId}
      enrichmentActionState={enrichmentActionState}
      onRequestEnrichment={handleRequestEnrichment}
      onRetry={() => {
        reloadOriginChannelIdRef.current = channelId;
        setReloadToken((currentValue) => currentValue + 1);
      }}
      requestState={requestState}
    />
  );
}
