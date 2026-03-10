"use client";

import type {
  ChannelAdvancedReportStatus,
  ChannelDetail,
  ChannelEnrichmentStatus,
  ChannelEstimatedPrice,
} from "@scouting-platform/contracts";
import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import { ApiRequestError, fetchChannelDetail } from "../../lib/channels-api";

type ChannelDetailShellProps = Readonly<{
  channelId: string;
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

type ChannelDetailShellViewProps = ChannelDetailShellProps & {
  requestState: ChannelDetailRequestState;
  onRetry: () => void;
};

const INITIAL_REQUEST_STATE: ChannelDetailRequestState = {
  status: "loading",
  data: null,
  error: null,
};

const EMPTY_VALUE = "Not available";

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

function renderReadyState(channel: ChannelDetail) {
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
            <p>Read-only enrichment status is visible here. Mutations stay in later milestones.</p>
          </header>

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
            <div>
              <dt>Last error</dt>
              <dd>{channel.enrichment.lastError ?? EMPTY_VALUE}</dd>
            </div>
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
      </div>
    </>
  );
}

export function ChannelDetailShellView({
  channelId,
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

      {requestState.status === "ready" ? renderReadyState(requestState.data) : null}
    </div>
  );
}

export function ChannelDetailShell({ channelId }: ChannelDetailShellProps) {
  const [requestState, setRequestState] = useState<ChannelDetailRequestState>(INITIAL_REQUEST_STATE);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    setRequestState({
      status: "loading",
      data: null,
      error: null,
    });

    void fetchChannelDetail(channelId, abortController.signal)
      .then((channel) => {
        if (abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "ready",
          data: channel,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (
          abortController.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return;
        }

        if (error instanceof ApiRequestError && error.status === 404) {
          setRequestState({
            status: "notFound",
            data: null,
            error: null,
          });
          return;
        }

        setRequestState({
          status: "error",
          data: null,
          error:
            error instanceof Error && error.message
              ? error.message
              : "Unable to load channel details. Please try again.",
        });
      });

    return () => {
      abortController.abort();
    };
  }, [channelId, reloadToken]);

  return (
    <ChannelDetailShellView
      channelId={channelId}
      onRetry={() => {
        setReloadToken((currentValue) => currentValue + 1);
      }}
      requestState={requestState}
    />
  );
}
