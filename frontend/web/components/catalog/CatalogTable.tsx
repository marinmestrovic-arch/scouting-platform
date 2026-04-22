import type {
  ChannelSummary,
  ListChannelsResponse,
} from "@scouting-platform/contracts";
import Image from "next/image";
import Link from "next/link";
import React, { memo } from "react";

import { DataTable } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import type {
  BatchEnrichmentActionState,
  CatalogCsvExportBatchState,
  CatalogHubspotPushBatchState,
  CatalogViewMode,
} from "./catalog-table-shared";
import {
  areAllCatalogPageRowsSelected,
  countSelectedCatalogPageRows,
  formatCatalogSelectionSummary,
  formatChannelCountSummary,
  formatChannelEngagementRate,
  formatChannelMetric,
  getChannelHandle,
  getEmptyCatalogMessage,
  getIdentityFallback,
  hasNextCatalogPage,
  hasPreviousCatalogPage,
} from "./catalog-table-shared";

const CatalogTableRow = memo(function CatalogTableRow({
  channel,
  isSelected,
  onToggle,
}: {
  channel: ChannelSummary;
  isSelected: boolean;
  onToggle: (channelId: string) => void;
}) {
  const socialLink = channel.socialMediaLink ?? channel.youtubeUrl ?? null;

  return (
    <tr className={isSelected ? "catalog-table__row catalog-table__row--selected" : "catalog-table__row"}>
      <td className="catalog-table__select-cell">
        <input
          aria-label={`Select ${channel.title}`}
          checked={isSelected}
          onChange={() => {
            onToggle(channel.id);
          }}
          suppressHydrationWarning
          type="checkbox"
        />
      </td>
      <td>
        <div className="catalog-table__identity">
          {channel.thumbnailUrl ? (
            <Image
              alt={`${channel.title} thumbnail`}
              className="catalog-table__thumbnail"
              height={48}
              src={channel.thumbnailUrl}
              unoptimized
              width={48}
            />
          ) : (
            <div className="catalog-table__thumbnail catalog-table__thumbnail--fallback" aria-hidden="true">
              {getIdentityFallback(channel)}
            </div>
          )}
          <div className="catalog-table__identity-copy">
            <Link className="catalog-table__title catalog-table__link" href={`/catalog/${channel.id}`}>
              {channel.title}
            </Link>
            <p className="catalog-table__meta">{getChannelHandle(channel)}</p>
          </div>
        </div>
      </td>
      <td>
        {socialLink ? (
          <a className="catalog-table__link" href={socialLink} rel="noreferrer" target="_blank">
            Open profile
          </a>
        ) : (
          <span className="catalog-table__meta">—</span>
        )}
      </td>
      <td>
        <span className="catalog-table__meta">
          {channel.platforms?.length ? channel.platforms.join(", ") : "—"}
        </span>
      </td>
      <td>{channel.countryRegion ?? "—"}</td>
      <td>{channel.email ?? "—"}</td>
      <td>{channel.influencerVertical ?? "—"}</td>
      <td>{channel.influencerType ?? "—"}</td>
      <td>{formatChannelEngagementRate(channel.youtubeEngagementRate ?? null)}</td>
      <td>{formatChannelMetric(channel.youtubeVideoMedianViews ?? null)}</td>
      <td>{formatChannelMetric(channel.youtubeShortsMedianViews ?? null)}</td>
      <td>{formatChannelMetric(channel.youtubeFollowers ?? null)}</td>
    </tr>
  );
});

function CatalogCard({
  channel,
}: {
  channel: ChannelSummary;
}) {
  return (
    <article className="catalog-card">
      <div className="catalog-card__media">
        {channel.thumbnailUrl ? (
          <Image
            alt={`${channel.title} thumbnail`}
            className="catalog-card__thumbnail"
            height={72}
            src={channel.thumbnailUrl}
            unoptimized
            width={72}
          />
        ) : (
          <div className="catalog-card__thumbnail catalog-card__thumbnail--fallback" aria-hidden="true">
            {getIdentityFallback(channel)}
          </div>
        )}
      </div>
      <div className="catalog-card__copy">
        <h3>
          <Link className="catalog-table__link" href={`/catalog/${channel.id}`}>
            {channel.title}
          </Link>
        </h3>
        <p className="catalog-card__handle">{getChannelHandle(channel)}</p>
        <p className="catalog-card__metric">
          Video median: {formatChannelMetric(channel.youtubeVideoMedianViews ?? null)}
        </p>
        <p className="catalog-card__metric">
          Shorts median: {formatChannelMetric(channel.youtubeShortsMedianViews ?? null)}
        </p>
        <p className="catalog-card__metric">
          Followers: {formatChannelMetric(channel.youtubeFollowers ?? null)}
        </p>
      </div>
      <div className="catalog-card__actions">
        <Link className="catalog-table__button" href={`/catalog/${channel.id}`}>
          Open detail
        </Link>
      </div>
    </article>
  );
}

type CatalogTableProps = Readonly<{
  batchEnrichmentActionState: BatchEnrichmentActionState;
  data: ListChannelsResponse;
  latestCsvExportBatch: CatalogCsvExportBatchState;
  latestHubspotPushBatch: CatalogHubspotPushBatchState;
  selectedChannelIds: readonly string[];
  viewMode?: CatalogViewMode;
  onClearSelection: () => void;
  onExportSelectedChannels: () => void | Promise<void>;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onPushSelectedChannelsToHubspot: () => void | Promise<void>;
  onRequestSelectedEnrichment: () => void | Promise<void>;
  onToggleChannelSelection: (channelId: string) => void;
  onTogglePageSelection: () => void;
}>;

export function CatalogTable({
  batchEnrichmentActionState,
  data,
  latestCsvExportBatch,
  latestHubspotPushBatch,
  selectedChannelIds,
  viewMode = "table",
  onClearSelection,
  onExportSelectedChannels,
  onNextPage,
  onPreviousPage,
  onPushSelectedChannelsToHubspot,
  onRequestSelectedEnrichment,
  onToggleChannelSelection,
  onTogglePageSelection,
}: CatalogTableProps) {
  const hasChannels = data.items.length > 0;
  const hasPreviousPage = hasPreviousCatalogPage(data);
  const hasNextPage = hasNextCatalogPage(data);
  const selectedOnPageCount = countSelectedCatalogPageRows(selectedChannelIds, data.items);
  const allRowsSelected = areAllCatalogPageRowsSelected(selectedChannelIds, data.items);
  const hasSelection = selectedChannelIds.length > 0;
  const isRequestingBatchEnrichment = batchEnrichmentActionState.type === "submitting";
  const isCreatingCsvExportBatch =
    latestCsvExportBatch.requestState === "loading" &&
    latestCsvExportBatch.summary === null &&
    latestCsvExportBatch.detail === null;
  const isCreatingHubspotPushBatch =
    latestHubspotPushBatch.requestState === "loading" &&
    latestHubspotPushBatch.summary === null &&
    latestHubspotPushBatch.detail === null;

  return (
    <>
      <div className="catalog-table__toolbar">
        <div className="catalog-table__toolbar-copy">
          <p className="catalog-table__summary">{formatChannelCountSummary(data)}</p>
          <p aria-live="polite" className="catalog-table__selection-summary">
            {formatCatalogSelectionSummary(selectedChannelIds.length, selectedOnPageCount)}
          </p>
        </div>
        <div className="catalog-table__pagination">
          <button
            className="catalog-table__button catalog-table__button--secondary"
            disabled={!hasPreviousPage}
            onClick={onPreviousPage}
            suppressHydrationWarning
            type="button"
          >
            Previous
          </button>
          <span className="catalog-table__page-indicator">Page {data.page}</span>
          <button
            className="catalog-table__button catalog-table__button--secondary"
            disabled={!hasNextPage}
            onClick={onNextPage}
            suppressHydrationWarning
            type="button"
          >
            Next
          </button>
        </div>
      </div>

      {viewMode === "table" && hasSelection ? (
        <div className="catalog-table__selection-actions">
          <button
            className="catalog-table__button"
            disabled={isRequestingBatchEnrichment}
            onClick={() => {
              void onRequestSelectedEnrichment();
            }}
            suppressHydrationWarning
            type="button"
          >
            {isRequestingBatchEnrichment ? "Requesting..." : `Enrich selected (${selectedChannelIds.length})`}
          </button>
          <button
            className="catalog-table__button"
            disabled={isCreatingCsvExportBatch}
            onClick={() => {
              void onExportSelectedChannels();
            }}
            suppressHydrationWarning
            type="button"
          >
            {isCreatingCsvExportBatch ? "Exporting..." : `Export selected (${selectedChannelIds.length})`}
          </button>
          <button
            className="catalog-table__button catalog-table__button--secondary"
            disabled={isCreatingHubspotPushBatch}
            onClick={() => {
              void onPushSelectedChannelsToHubspot();
            }}
            suppressHydrationWarning
            type="button"
          >
            {isCreatingHubspotPushBatch ? "Starting push..." : `Push to HubSpot (${selectedChannelIds.length})`}
          </button>
          <button
            className="catalog-table__button catalog-table__button--secondary"
            onClick={onClearSelection}
            suppressHydrationWarning
            type="button"
          >
            Clear selection
          </button>
        </div>
      ) : null}

      {viewMode === "cards" ? (
        <div className="catalog-table__selection-actions catalog-table__selection-actions--disabled">
          <button
            className="catalog-table__button catalog-table__button--secondary"
            disabled
            title="Switch to table view to select multiple channels"
            type="button"
          >
            Bulk actions
          </button>
        </div>
      ) : null}

      {batchEnrichmentActionState.message ? (
        <p
          aria-live="polite"
          className={`catalog-table__selection-status catalog-table__selection-status--${batchEnrichmentActionState.type}`}
          role={batchEnrichmentActionState.type === "error" ? "alert" : undefined}
        >
          {batchEnrichmentActionState.message}
        </p>
      ) : null}

      {!hasChannels ? (
        <EmptyState description={getEmptyCatalogMessage(data)} title="No channels found" />
      ) : viewMode === "cards" ? (
        <div className="catalog-card-grid">
          {data.items.map((channel) => (
            <CatalogCard channel={channel} key={channel.id} />
          ))}
        </div>
      ) : (
        <DataTable caption="Catalog channels" density="compact">
          <thead>
            <tr>
              <th scope="col">
                <div className="catalog-table__select-header">
                  <span>Select</span>
                  <input
                    aria-label="Select all channels on this page"
                    checked={allRowsSelected}
                    disabled={!hasChannels}
                    onChange={onTogglePageSelection}
                    suppressHydrationWarning
                    type="checkbox"
                  />
                </div>
              </th>
              <th scope="col">Channel</th>
              <th scope="col">Social Media Link</th>
              <th scope="col">Platforms</th>
              <th scope="col">Country/Region</th>
              <th scope="col">Email</th>
              <th scope="col">Influencer Vertical</th>
              <th scope="col">Influencer Type</th>
              <th scope="col">YouTube Engagement Rate</th>
              <th scope="col">YouTube Video Median Views</th>
              <th scope="col">YouTube Shorts Median Views</th>
              <th scope="col">YouTube Followers</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((channel) => (
              <CatalogTableRow
                channel={channel}
                isSelected={selectedChannelIds.includes(channel.id)}
                key={channel.id}
                onToggle={onToggleChannelSelection}
              />
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
