"use client";

import type {
  ChannelAdvancedReportStatus,
  ChannelEnrichmentDetail,
  ChannelEnrichmentStatus,
  ChannelSummary,
  CsvExportBatchDetail,
  CsvExportBatchSummary,
  CsvExportBatchStatus,
  HubspotPushBatchDetail,
  HubspotPushBatchRow,
  HubspotPushBatchSummary,
  HubspotPushBatchStatus,
  ListChannelsResponse,
  SegmentResponse,
} from "@scouting-platform/contracts";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";

import {
  requestChannelEnrichmentBatch,
  type BatchChannelEnrichmentRequestResult,
  fetchChannels,
} from "../../lib/channels-api";
import {
  createCsvExportBatch,
  fetchCsvExportBatchDetail,
  getCsvExportBatchDownloadUrl,
} from "../../lib/csv-export-batches-api";
import {
  createHubspotPushBatch,
  fetchHubspotPushBatchDetail,
} from "../../lib/hubspot-push-batches-api";
import {
  createSavedSegment,
  deleteSavedSegment,
  fetchSavedSegments,
} from "../../lib/segments-api";
import {
  getCsvExportBatchResultHref,
  getHubspotPushBatchResultHref,
} from "../../lib/navigation";
import {
  ADVANCED_REPORT_FILTER_OPTIONS,
  ENRICHMENT_FILTER_OPTIONS,
  DEFAULT_CATALOG_FILTERS,
  areCatalogFiltersEqual,
  buildCatalogHref,
  buildCatalogSearchParams,
  buildSavedSegmentFilters,
  formatSavedSegmentSummary,
  getCatalogFiltersFromSavedSegment,
  hasActiveCatalogFilters,
  parseCatalogUrlState,
  toggleCatalogStatusFilter,
  type CatalogFilterOption,
  type CatalogFiltersState,
  type CatalogUrlState,
} from "../../lib/catalog-filters";

export {
  areCatalogFiltersEqual,
  buildCatalogHref,
  buildCatalogSearchParams,
  buildSavedSegmentFilters,
  formatSavedSegmentSummary,
  getCatalogFiltersFromSavedSegment,
  normalizeCatalogFilters,
  parseCatalogUrlState,
  toggleCatalogStatusFilter,
} from "../../lib/catalog-filters";

type CatalogTableShellProps = {
  pageSize?: number;
};

type CatalogTableRequestState =
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
      data: ListChannelsResponse;
      error: null;
    };

type SavedSegmentsRequestState =
  | {
      status: "loading";
      error: null;
    }
  | {
      status: "error";
      error: string;
    }
  | {
      status: "ready";
      error: null;
    };

type SavedSegmentOperationStatus = {
  type: "idle" | "success" | "error";
  message: string;
};

type BatchEnrichmentActionState = {
  type: "idle" | "submitting" | "success" | "error";
  message: string;
};

type CatalogCsvExportBatchState = {
  requestState: "idle" | "loading" | "ready" | "error";
  summary: CsvExportBatchSummary | null;
  detail: CsvExportBatchDetail | null;
  error: string | null;
  isRefreshing: boolean;
};

type CatalogHubspotPushBatchState = {
  requestState: "idle" | "loading" | "ready" | "error";
  summary: HubspotPushBatchSummary | null;
  detail: HubspotPushBatchDetail | null;
  error: string | null;
  isRefreshing: boolean;
};

type CatalogTableShellViewProps = {
  draftFilters: CatalogFiltersState;
  requestState: CatalogTableRequestState;
  selectedChannelIds: readonly string[];
  savedSegments: SegmentResponse[];
  savedSegmentsRequestState: SavedSegmentsRequestState;
  savedSegmentName: string;
  savedSegmentOperationStatus: SavedSegmentOperationStatus;
  batchEnrichmentActionState: BatchEnrichmentActionState;
  latestCsvExportBatch: CatalogCsvExportBatchState;
  latestHubspotPushBatch: CatalogHubspotPushBatchState;
  pendingSegmentAction: string | null;
  hasPendingFilterChanges: boolean;
  onSavedSegmentNameChange: (value: string) => void;
  onCreateSegment: () => void | Promise<void>;
  onLoadSegment: (segment: SegmentResponse) => void;
  onDeleteSegment: (segment: SegmentResponse) => void | Promise<void>;
  onRetrySavedSegments: () => void;
  onDraftQueryChange: (value: string) => void;
  onToggleEnrichmentStatus: (value: ChannelEnrichmentStatus) => void;
  onToggleAdvancedReportStatus: (value: ChannelAdvancedReportStatus) => void;
  onToggleChannelSelection: (channelId: string) => void;
  onTogglePageSelection: () => void;
  onExportSelectedChannels: () => void | Promise<void>;
  onPushSelectedChannelsToHubspot: () => void | Promise<void>;
  onRequestSelectedEnrichment: () => void | Promise<void>;
  onClearSelection: () => void;
  onApplyFilters: () => void;
  onResetFilters: () => void;
  onRetry: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
};

const DEFAULT_PAGE_SIZE = 20;
export const CATALOG_ENRICHMENT_POLL_INTERVAL_MS = 3000;
export const CATALOG_BATCH_STATUS_POLL_INTERVAL_MS = 3000;

const IDLE_SAVED_SEGMENT_OPERATION_STATUS: SavedSegmentOperationStatus = {
  type: "idle",
  message: "",
};

const IDLE_BATCH_ENRICHMENT_ACTION_STATE: BatchEnrichmentActionState = {
  type: "idle",
  message: "",
};

const IDLE_CSV_EXPORT_BATCH_STATE: CatalogCsvExportBatchState = {
  requestState: "idle",
  summary: null,
  detail: null,
  error: null,
  isRefreshing: false,
};

const IDLE_HUBSPOT_PUSH_BATCH_STATE: CatalogHubspotPushBatchState = {
  requestState: "idle",
  summary: null,
  detail: null,
  error: null,
  isRefreshing: false,
};

type CatalogPaginationState = Pick<ListChannelsResponse, "page" | "pageSize" | "total">;

function formatCatalogTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);

  if (!match) {
    return value;
  }

  return `${match[1]} ${match[2]} UTC`;
}

function getCatalogEnrichmentActivityTimestamp(
  enrichment: Pick<ChannelSummary["enrichment"], "completedAt" | "updatedAt">,
): string | null {
  return formatCatalogTimestamp(enrichment.completedAt ?? enrichment.updatedAt);
}

export function getCatalogEnrichmentDetailCopy(
  enrichment: ChannelSummary["enrichment"],
): string {
  switch (enrichment.status) {
    case "missing":
      return "No enrichment requested yet.";
    case "queued":
      return "Queued and auto-refreshing.";
    case "running":
      return "Running and auto-refreshing.";
    case "completed": {
      const timestamp = getCatalogEnrichmentActivityTimestamp(enrichment);
      return timestamp ? `Completed ${timestamp}.` : "Completed and ready for review.";
    }
    case "failed":
      return enrichment.lastError
        ? `Last attempt failed: ${enrichment.lastError}`
        : "Last attempt failed before the worker completed.";
    case "stale": {
      const timestamp = getCatalogEnrichmentActivityTimestamp(enrichment);
      return timestamp ? `Stale since ${timestamp}.` : "Stale and should be refreshed.";
    }
    default:
      return enrichment.status;
  }
}

export function shouldPollCatalogEnrichmentRows(
  data: Pick<ListChannelsResponse, "items">,
): boolean {
  return data.items.some(
    (channel) =>
      channel.enrichment.status === "queued" || channel.enrichment.status === "running",
  );
}

export function formatChannelCountSummary(data: ListChannelsResponse): string {
  if (data.total === 0) {
    return "0 channels";
  }

  if (data.items.length === 0) {
    return `Showing 0 of ${data.total} channels`;
  }

  const firstItemIndex = (data.page - 1) * data.pageSize + 1;
  const lastItemIndex = firstItemIndex + data.items.length - 1;

  return `Showing ${firstItemIndex}-${Math.min(lastItemIndex, data.total)} of ${data.total} channels`;
}

export function getEmptyCatalogMessage(data: Pick<ListChannelsResponse, "total">): string {
  if (data.total === 0) {
    return "No channels match the current filters.";
  }

  return "No channels found on this page.";
}

export function hasPreviousCatalogPage(data: CatalogPaginationState): boolean {
  return data.page > 1;
}

export function hasNextCatalogPage(data: CatalogPaginationState): boolean {
  return data.page * data.pageSize < data.total;
}

export function getPreviousCatalogPage(data: CatalogPaginationState): number | null {
  if (!hasPreviousCatalogPage(data)) {
    return null;
  }

  return data.page - 1;
}

export function getNextCatalogPage(data: CatalogPaginationState): number | null {
  if (!hasNextCatalogPage(data)) {
    return null;
  }

  return data.page + 1;
}

function getChannelHandle(channel: ChannelSummary): string {
  return channel.handle?.trim() || "No handle";
}

function formatChannelMetric(value: string | null): string {
  if (!value) {
    return "—";
  }

  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue)) {
    return value;
  }

  return new Intl.NumberFormat("en-US").format(parsedValue);
}

function formatChannelEngagementRate(value: number | null): string {
  if (value === null) {
    return "—";
  }

  return `${value.toFixed(1)}%`;
}

function getIdentityFallback(channel: ChannelSummary): string {
  return channel.title.trim().charAt(0).toUpperCase() || "?";
}

function sortSavedSegments(segments: readonly SegmentResponse[]): SegmentResponse[] {
  return [...segments].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function upsertSavedSegment(
  segments: readonly SegmentResponse[],
  segment: SegmentResponse,
): SegmentResponse[] {
  return sortSavedSegments([segment, ...segments.filter((item) => item.id !== segment.id)]);
}

function getSavedSegmentErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to manage saved segments. Please try again.";
}

function getCatalogCsvExportBatchCreateErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to create the CSV export batch. Please try again.";
}

function getCatalogCsvExportBatchDetailErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to load CSV export batch status. Please try again.";
}

function getCatalogHubspotPushBatchCreateErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to create the HubSpot push batch. Please try again.";
}

function getCatalogHubspotPushBatchDetailErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to load HubSpot push batch status. Please try again.";
}

function getCatalogPageChannelIds(channels: readonly Pick<ChannelSummary, "id">[]): string[] {
  return [...new Set(channels.map((channel) => channel.id))];
}

export function countSelectedCatalogPageRows(
  selectedChannelIds: readonly string[],
  channels: readonly Pick<ChannelSummary, "id">[],
): number {
  const selected = new Set(selectedChannelIds);

  return getCatalogPageChannelIds(channels).filter((channelId) => selected.has(channelId)).length;
}

export function areAllCatalogPageRowsSelected(
  selectedChannelIds: readonly string[],
  channels: readonly Pick<ChannelSummary, "id">[],
): boolean {
  const pageChannelIds = getCatalogPageChannelIds(channels);

  return (
    pageChannelIds.length > 0 &&
    countSelectedCatalogPageRows(selectedChannelIds, channels) === pageChannelIds.length
  );
}

export function toggleCatalogChannelSelection(
  selectedChannelIds: readonly string[],
  channelId: string,
): string[] {
  if (selectedChannelIds.includes(channelId)) {
    return selectedChannelIds.filter((value) => value !== channelId);
  }

  return [...selectedChannelIds, channelId];
}

export function toggleCatalogPageSelection(
  selectedChannelIds: readonly string[],
  channels: readonly Pick<ChannelSummary, "id">[],
): string[] {
  const pageChannelIds = getCatalogPageChannelIds(channels);

  if (pageChannelIds.length === 0) {
    return [...new Set(selectedChannelIds)];
  }

  const pageChannelIdSet = new Set(pageChannelIds);

  if (areAllCatalogPageRowsSelected(selectedChannelIds, channels)) {
    return selectedChannelIds.filter((channelId) => !pageChannelIdSet.has(channelId));
  }

  const nextSelectedChannelIds = [...selectedChannelIds];
  const selectedChannelIdSet = new Set(selectedChannelIds);

  for (const channelId of pageChannelIds) {
    if (!selectedChannelIdSet.has(channelId)) {
      nextSelectedChannelIds.push(channelId);
    }
  }

  return nextSelectedChannelIds;
}

export function formatCatalogSelectionSummary(
  selectedCount: number,
  selectedOnPageCount: number,
): string {
  if (selectedCount === 0) {
    return "No channels selected.";
  }

  const summary = `${selectedCount} channel${selectedCount === 1 ? "" : "s"} selected`;

  if (selectedOnPageCount === selectedCount) {
    return summary;
  }

  if (selectedOnPageCount === 0) {
    return `${summary} · none on this page`;
  }

  return `${summary} · ${selectedOnPageCount} on this page`;
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

function getCsvExportBatchSnapshot(
  state: CatalogCsvExportBatchState,
): CsvExportBatchSummary | CsvExportBatchDetail | null {
  return state.detail ?? state.summary;
}

function getHubspotPushBatchSnapshot(
  state: CatalogHubspotPushBatchState,
): HubspotPushBatchSummary | HubspotPushBatchDetail | null {
  return state.detail ?? state.summary;
}

function getCsvExportBatchStatus(
  state: CatalogCsvExportBatchState,
): CsvExportBatchStatus | null {
  return getCsvExportBatchSnapshot(state)?.status ?? null;
}

function getHubspotPushBatchStatus(
  state: CatalogHubspotPushBatchState,
): HubspotPushBatchStatus | null {
  return getHubspotPushBatchSnapshot(state)?.status ?? null;
}

export function shouldPollCatalogCsvExportBatch(state: CatalogCsvExportBatchState): boolean {
  const status = getCsvExportBatchStatus(state);

  return status === "queued" || status === "running";
}

export function shouldPollCatalogHubspotPushBatch(
  state: CatalogHubspotPushBatchState,
): boolean {
  const status = getHubspotPushBatchStatus(state);

  return status === "queued" || status === "running";
}

function getCatalogBatchStatusLabel(status: string): string {
  return toTitleCase(status);
}

function getCsvExportBatchTimestamp(state: CatalogCsvExportBatchState): string | null {
  const batch = getCsvExportBatchSnapshot(state);

  if (!batch) {
    return null;
  }

  return formatCatalogTimestamp(batch.completedAt ?? batch.updatedAt);
}

function getHubspotPushBatchTimestamp(state: CatalogHubspotPushBatchState): string | null {
  const batch = getHubspotPushBatchSnapshot(state);

  if (!batch) {
    return null;
  }

  return formatCatalogTimestamp(batch.completedAt ?? batch.updatedAt);
}

function getCsvExportBatchSummaryCopy(state: CatalogCsvExportBatchState): string {
  const batch = getCsvExportBatchSnapshot(state);

  if (!batch) {
    if (state.requestState === "loading") {
      return "Creating selected export batch...";
    }

    return state.error ?? "";
  }

  switch (batch.status) {
    case "queued":
      return "Export queued and refreshing automatically.";
    case "running":
      return "Export is running in the background and refreshing automatically.";
    case "completed":
      return `Completed with ${formatSelectedChannelCount(batch.rowCount)} in the CSV. Download is ready.`;
    case "failed":
      return batch.lastError
        ? `Export failed: ${ensureTerminalPunctuation(batch.lastError)}`
        : "Export failed before the worker finished.";
    default:
      return batch.status;
  }
}

function getHubspotPushBatchSummaryCopy(state: CatalogHubspotPushBatchState): string {
  const batch = getHubspotPushBatchSnapshot(state);

  if (!batch) {
    if (state.requestState === "loading") {
      return "Creating HubSpot push batch...";
    }

    return state.error ?? "";
  }

  switch (batch.status) {
    case "queued":
      return "HubSpot push queued and refreshing automatically.";
    case "running":
      return "HubSpot push is running in the background and refreshing automatically.";
    case "completed":
      return `${batch.pushedRowCount} pushed · ${batch.failedRowCount} failed.`;
    case "failed":
      return batch.lastError
        ? `HubSpot push failed: ${ensureTerminalPunctuation(batch.lastError)}`
        : "HubSpot push failed before the worker finished.";
    default:
      return batch.status;
  }
}

function getFailedHubspotPushRows(state: CatalogHubspotPushBatchState): HubspotPushBatchRow[] {
  return state.detail?.rows.filter((row) => row.status === "failed") ?? [];
}

function getHubspotPushFailedRowLabel(row: HubspotPushBatchRow): string {
  const identity = row.contactEmail?.trim() ? row.contactEmail : row.channelId;

  return `${identity}: ${ensureTerminalPunctuation(
    row.errorMessage ?? "Unknown HubSpot row failure",
  )}`;
}

function formatSelectedChannelCount(count: number): string {
  return `${count} channel${count === 1 ? "" : "s"}`;
}

function getBatchEnrichmentSubmittingMessage(selectedCount: number): string {
  return `Requesting enrichment for ${formatSelectedChannelCount(selectedCount)}.`;
}

function ensureTerminalPunctuation(message: string): string {
  const trimmed = message.trim();

  if (!trimmed) {
    return trimmed;
  }

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function getBatchEnrichmentFailureMessage(messages: readonly string[]): string {
  const failureCount = messages.length;
  const prefix = `${failureCount} request${failureCount === 1 ? "" : "s"} failed`;
  const uniqueMessages = [...new Set(messages.map((message) => message.trim()).filter(Boolean))];
  const firstMessage = uniqueMessages[0];

  if (uniqueMessages.length === 0) {
    return `${prefix}.`;
  }

  if (firstMessage && uniqueMessages.length === 1) {
    return `${prefix}: ${ensureTerminalPunctuation(firstMessage)}`;
  }

  return `${prefix}. First error: ${ensureTerminalPunctuation(firstMessage ?? "")}`;
}

function isBatchEnrichmentSuccess(
  result: BatchChannelEnrichmentRequestResult,
): result is Extract<BatchChannelEnrichmentRequestResult, { ok: true }> {
  return result.ok;
}

function toCatalogEnrichmentSummary(
  enrichment: ChannelEnrichmentDetail,
): ChannelSummary["enrichment"] {
  return {
    status: enrichment.status,
    updatedAt: enrichment.updatedAt,
    completedAt: enrichment.completedAt,
    lastError: enrichment.lastError,
  };
}

export function mergeCatalogBatchEnrichmentResults(
  data: ListChannelsResponse,
  results: readonly BatchChannelEnrichmentRequestResult[],
): ListChannelsResponse {
  const enrichmentByChannelId = new Map(
    results
      .filter(isBatchEnrichmentSuccess)
      .map((result) => [result.channelId, toCatalogEnrichmentSummary(result.enrichment)]),
  );

  if (enrichmentByChannelId.size === 0) {
    return data;
  }

  return {
    ...data,
    items: data.items.map((channel) => {
      const enrichment = enrichmentByChannelId.get(channel.id);

      if (!enrichment) {
        return channel;
      }

      return {
        ...channel,
        enrichment,
      };
    }),
  };
}

export function summarizeCatalogBatchEnrichmentResults(
  results: readonly BatchChannelEnrichmentRequestResult[],
): BatchEnrichmentActionState {
  const queuedCount = results.filter(
    (result) => isBatchEnrichmentSuccess(result) && result.enrichment.status === "queued",
  ).length;
  const runningCount = results.filter(
    (result) => isBatchEnrichmentSuccess(result) && result.enrichment.status === "running",
  ).length;
  const completedCount = results.filter(
    (result) => isBatchEnrichmentSuccess(result) && result.enrichment.status === "completed",
  ).length;
  const failureMessages = results
    .filter((result): result is Extract<BatchChannelEnrichmentRequestResult, { ok: false }> => !result.ok)
    .map((result) => result.error.message);
  const parts: string[] = [];

  if (queuedCount > 0) {
    parts.push(`Queued ${formatSelectedChannelCount(queuedCount)} for enrichment.`);
  }

  if (runningCount > 0) {
    parts.push(`${formatSelectedChannelCount(runningCount)} already running.`);
  }

  if (completedCount > 0) {
    parts.push(`${formatSelectedChannelCount(completedCount)} already ready.`);
  }

  if (failureMessages.length > 0) {
    parts.push(getBatchEnrichmentFailureMessage(failureMessages));
  }

  if (queuedCount > 0 || runningCount > 0) {
    parts.push("The table refreshes automatically while jobs run.");
  }

  if (parts.length === 0) {
    parts.push("No enrichment requests were recorded.");
  }

  return {
    type: failureMessages.length > 0 ? "error" : "success",
    message: parts.join(" "),
  };
}

function FilterCheckboxGroup<T extends string>({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: ReadonlyArray<CatalogFilterOption<T>>;
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="catalog-table__filter-group">
      <legend>{legend}</legend>
      <div className="catalog-table__filter-options">
        {options.map((option) => {
          const checked = selected.includes(option.value);

          return (
            <label
              key={option.value}
              className={`catalog-table__filter-option${checked ? " catalog-table__filter-option--selected" : ""}`}
            >
              <input
                checked={checked}
                onChange={() => {
                  onToggle(option.value);
                }}
                suppressHydrationWarning
                type="checkbox"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function CatalogSelectionBatchCards({
  latestCsvExportBatch,
  latestHubspotPushBatch,
}: {
  latestCsvExportBatch: CatalogCsvExportBatchState;
  latestHubspotPushBatch: CatalogHubspotPushBatchState;
}) {
  const csvExportBatch = getCsvExportBatchSnapshot(latestCsvExportBatch);
  const hubspotPushBatch = getHubspotPushBatchSnapshot(latestHubspotPushBatch);
  const failedHubspotRows = getFailedHubspotPushRows(latestHubspotPushBatch).slice(0, 3);
  const shouldShowCsvExportCard = latestCsvExportBatch.requestState !== "idle";
  const shouldShowHubspotPushCard = latestHubspotPushBatch.requestState !== "idle";

  if (!shouldShowCsvExportCard && !shouldShowHubspotPushCard) {
    return null;
  }

  return (
    <div className="catalog-table__batch-grid">
      {shouldShowCsvExportCard ? (
        <article className="catalog-table__batch-card" aria-labelledby="catalog-latest-export-heading">
          <header className="catalog-table__batch-card-header">
            <div>
              <p className="catalog-table__batch-eyebrow">Latest batch</p>
              <h3 id="catalog-latest-export-heading">CSV export</h3>
            </div>
            <span
              className={`catalog-table__batch-status catalog-table__batch-status--${
                csvExportBatch?.status ??
                (latestCsvExportBatch.requestState === "error" ? "failed" : "loading")
              }`}
            >
              {csvExportBatch
                ? getCatalogBatchStatusLabel(csvExportBatch.status)
                : latestCsvExportBatch.requestState === "error"
                  ? "Error"
                  : "Starting"}
            </span>
          </header>

          <p className="catalog-table__batch-copy">{getCsvExportBatchSummaryCopy(latestCsvExportBatch)}</p>

          {latestCsvExportBatch.isRefreshing ? (
            <p className="catalog-table__batch-inline-note" role="status">
              Refreshing export status...
            </p>
          ) : null}

          {latestCsvExportBatch.error && csvExportBatch ? (
            <p className="catalog-table__batch-error" role="alert">
              Last refresh failed: {latestCsvExportBatch.error}
            </p>
          ) : null}

          {csvExportBatch ? (
            <>
              <dl className="catalog-table__batch-meta">
                <div>
                  <dt>File</dt>
                  <dd>{csvExportBatch.fileName}</dd>
                </div>
                <div>
                  <dt>Rows</dt>
                  <dd>{csvExportBatch.rowCount}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{getCsvExportBatchTimestamp(latestCsvExportBatch) ?? "Not available"}</dd>
                </div>
              </dl>

              {csvExportBatch.status === "completed" ? (
                <div className="catalog-table__batch-actions">
                  <a
                    className="catalog-table__button catalog-table__button--secondary"
                    download
                    href={getCsvExportBatchDownloadUrl(csvExportBatch.id)}
                  >
                    Download CSV
                  </a>
                  <Link
                    className="catalog-table__button catalog-table__button--secondary"
                    href={getCsvExportBatchResultHref(csvExportBatch.id)}
                  >
                    Open batch result
                  </Link>
                </div>
              ) : (
                <div className="catalog-table__batch-actions">
                  <Link
                    className="catalog-table__button catalog-table__button--secondary"
                    href={getCsvExportBatchResultHref(csvExportBatch.id)}
                  >
                    Open batch result
                  </Link>
                </div>
              )}
            </>
          ) : null}
        </article>
      ) : null}

      {shouldShowHubspotPushCard ? (
        <article className="catalog-table__batch-card" aria-labelledby="catalog-latest-hubspot-heading">
          <header className="catalog-table__batch-card-header">
            <div>
              <p className="catalog-table__batch-eyebrow">Latest batch</p>
              <h3 id="catalog-latest-hubspot-heading">HubSpot push</h3>
            </div>
            <span
              className={`catalog-table__batch-status catalog-table__batch-status--${
                hubspotPushBatch?.status ??
                (latestHubspotPushBatch.requestState === "error" ? "failed" : "loading")
              }`}
            >
              {hubspotPushBatch
                ? getCatalogBatchStatusLabel(hubspotPushBatch.status)
                : latestHubspotPushBatch.requestState === "error"
                  ? "Error"
                  : "Starting"}
            </span>
          </header>

          <p className="catalog-table__batch-copy">{getHubspotPushBatchSummaryCopy(latestHubspotPushBatch)}</p>

          {latestHubspotPushBatch.isRefreshing ? (
            <p className="catalog-table__batch-inline-note" role="status">
              Refreshing HubSpot status...
            </p>
          ) : null}

          {latestHubspotPushBatch.error && hubspotPushBatch ? (
            <p className="catalog-table__batch-error" role="alert">
              Last refresh failed: {latestHubspotPushBatch.error}
            </p>
          ) : null}

          {hubspotPushBatch ? (
            <>
              <dl className="catalog-table__batch-meta">
                <div>
                  <dt>Total</dt>
                  <dd>{hubspotPushBatch.totalRowCount}</dd>
                </div>
                <div>
                  <dt>Pushed</dt>
                  <dd>{hubspotPushBatch.pushedRowCount}</dd>
                </div>
                <div>
                  <dt>Failed</dt>
                  <dd>{hubspotPushBatch.failedRowCount}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{getHubspotPushBatchTimestamp(latestHubspotPushBatch) ?? "Not available"}</dd>
                </div>
              </dl>

              {failedHubspotRows.length > 0 ? (
                <div className="catalog-table__batch-failures">
                  <h4>Failed rows</h4>
                  <ul className="catalog-table__batch-failure-list">
                    {failedHubspotRows.map((row) => (
                      <li key={row.id}>{getHubspotPushFailedRowLabel(row)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}

          <div className="catalog-table__batch-actions">
            <Link
              className="catalog-table__button catalog-table__button--secondary"
              href={
                hubspotPushBatch ? getHubspotPushBatchResultHref(hubspotPushBatch.id) : "/hubspot"
              }
            >
              Open batch result
            </Link>
          </div>
        </article>
      ) : null}
    </div>
  );
}

export function CatalogTableShellView({
  draftFilters,
  requestState,
  selectedChannelIds,
  savedSegments,
  savedSegmentsRequestState,
  savedSegmentName,
  savedSegmentOperationStatus,
  batchEnrichmentActionState,
  latestCsvExportBatch,
  latestHubspotPushBatch,
  pendingSegmentAction,
  hasPendingFilterChanges,
  onSavedSegmentNameChange,
  onCreateSegment,
  onLoadSegment,
  onDeleteSegment,
  onRetrySavedSegments,
  onDraftQueryChange,
  onToggleEnrichmentStatus,
  onToggleAdvancedReportStatus,
  onToggleChannelSelection,
  onTogglePageSelection,
  onExportSelectedChannels,
  onPushSelectedChannelsToHubspot,
  onRequestSelectedEnrichment,
  onClearSelection,
  onApplyFilters,
  onResetFilters,
  onRetry,
  onPreviousPage,
  onNextPage,
}: CatalogTableShellViewProps) {
  const activeFilters = hasActiveCatalogFilters(draftFilters);
  const isSavingSegment = pendingSegmentAction === "create";
  const hasSavedSegments = savedSegments.length > 0;
  const activeFilterCount =
    (draftFilters.query.trim() ? 1 : 0) +
    draftFilters.enrichmentStatus.length +
    draftFilters.advancedReportStatus.length;
  const hasSelection = selectedChannelIds.length > 0;

  return (
    <div className="catalog-table">
      <section aria-labelledby="catalog-filter-heading" className="catalog-table__controls">
        <h2 className="catalog-table__sr-only" id="catalog-filter-heading">
          Catalog controls
        </h2>

        <div className="catalog-table__control-row">
          <label className="catalog-table__search catalog-table__search--primary">
            <input
              aria-label="Search creators"
              name="query"
              onChange={(event) => {
                onDraftQueryChange(event.target.value);
              }}
              placeholder="Search creators..."
              suppressHydrationWarning
              type="search"
              value={draftFilters.query}
            />
          </label>

          <details className="catalog-table__filter-pill">
            <summary>
              Enrichment Status
              {draftFilters.enrichmentStatus.length > 0 ? ` (${draftFilters.enrichmentStatus.length})` : ""}
            </summary>
            <div className="catalog-table__filter-popover">
              <FilterCheckboxGroup
                legend="Enrichment status"
                onToggle={onToggleEnrichmentStatus}
                options={ENRICHMENT_FILTER_OPTIONS}
                selected={draftFilters.enrichmentStatus}
              />
            </div>
          </details>

          <details className="catalog-table__filter-pill">
            <summary>
              Report Status
              {draftFilters.advancedReportStatus.length > 0 ? ` (${draftFilters.advancedReportStatus.length})` : ""}
            </summary>
            <div className="catalog-table__filter-popover">
              <FilterCheckboxGroup
                legend="Advanced report status"
                onToggle={onToggleAdvancedReportStatus}
                options={ADVANCED_REPORT_FILTER_OPTIONS}
                selected={draftFilters.advancedReportStatus}
              />
            </div>
          </details>

          <button
            className="catalog-table__button catalog-table__button--secondary"
            disabled={!activeFilters && !hasPendingFilterChanges}
            onClick={onResetFilters}
            suppressHydrationWarning
            type="button"
          >
            Clear
          </button>

          <button
            className="catalog-table__button"
            onClick={onApplyFilters}
            suppressHydrationWarning
            type="button"
          >
            Apply
          </button>
        </div>

        <div className="catalog-table__control-row catalog-table__control-row--secondary">
          <details className="catalog-table__segments-pill">
            <summary>
              Segments
              {hasSavedSegments ? ` (${savedSegments.length})` : ""}
            </summary>
            <div className="catalog-table__segments-popover">
              <div className="catalog-table__segments-actions">
                <label className="catalog-table__search">
                  <span>Segment name</span>
                  <input
                    name="segmentName"
                    onChange={(event) => {
                      onSavedSegmentNameChange(event.target.value);
                    }}
                    placeholder="Space creators"
                    suppressHydrationWarning
                    type="text"
                    value={savedSegmentName}
                  />
                </label>

                <button
                  className="catalog-table__button"
                  disabled={isSavingSegment || savedSegmentName.trim().length === 0}
                  onClick={() => {
                    void onCreateSegment();
                  }}
                  suppressHydrationWarning
                  type="button"
                >
                  {isSavingSegment ? "Saving..." : "Save"}
                </button>
              </div>

              {savedSegmentOperationStatus.message ? (
                <p
                  className={`catalog-table__segment-status catalog-table__segment-status--${savedSegmentOperationStatus.type}`}
                  role={savedSegmentOperationStatus.type === "error" ? "alert" : undefined}
                >
                  {savedSegmentOperationStatus.message}
                </p>
              ) : null}

              {savedSegmentsRequestState.status === "loading" && !hasSavedSegments ? (
                <p className="catalog-table__feedback catalog-table__feedback--loading">
                  Loading saved segments...
                </p>
              ) : null}

              {savedSegmentsRequestState.status === "error" ? (
                <div className="catalog-table__feedback catalog-table__feedback--error" role="alert">
                  <p>{savedSegmentsRequestState.error}</p>
                  <button
                    className="catalog-table__button catalog-table__button--secondary"
                    onClick={onRetrySavedSegments}
                    suppressHydrationWarning
                    type="button"
                  >
                    Retry
                  </button>
                </div>
              ) : null}

              {!hasSavedSegments && savedSegmentsRequestState.status === "ready" ? (
                <p className="catalog-table__feedback catalog-table__feedback--empty">
                  No saved segments yet.
                </p>
              ) : null}

              {hasSavedSegments ? (
                <ul className="catalog-table__segment-list">
                  {savedSegments.map((segment) => {
                    const isDeletingSegment = pendingSegmentAction === `delete:${segment.id}`;

                    return (
                      <li className="catalog-table__segment-item" key={segment.id}>
                        <div className="catalog-table__segment-copy">
                          <h3>{segment.name}</h3>
                          <p>{formatSavedSegmentSummary(segment.filters)}</p>
                        </div>
                        <div className="catalog-table__segment-item-actions">
                          <button
                            className="catalog-table__button catalog-table__button--secondary"
                            disabled={pendingSegmentAction !== null}
                            onClick={() => {
                              onLoadSegment(segment);
                            }}
                            suppressHydrationWarning
                            type="button"
                          >
                            Load
                          </button>
                          <button
                            className="catalog-table__button catalog-table__button--secondary"
                            disabled={pendingSegmentAction !== null}
                            onClick={() => {
                              void onDeleteSegment(segment);
                            }}
                            suppressHydrationWarning
                            type="button"
                          >
                            {isDeletingSegment ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </details>

          <button
            className="catalog-table__button"
            disabled={!hasSelection}
            onClick={() => {
              void onExportSelectedChannels();
            }}
            suppressHydrationWarning
            type="button"
          >
            {hasSelection ? `Export (${selectedChannelIds.length})` : "Export"}
          </button>

          {hasPendingFilterChanges ? (
            <p className="catalog-table__filter-note">Draft changes are ready to apply.</p>
          ) : null}

          {activeFilterCount > 0 ? (
            <p className="catalog-table__filter-note">Active filters: {activeFilterCount}</p>
          ) : null}
        </div>
      </section>

      {requestState.status === "loading" ? (
        <p className="catalog-table__feedback catalog-table__feedback--loading">Loading channels...</p>
      ) : null}

      {requestState.status === "error" ? (
        <div className="catalog-table__feedback catalog-table__feedback--error" role="alert">
          <p>{requestState.error}</p>
          <button
            className="catalog-table__button catalog-table__button--secondary"
            onClick={onRetry}
            suppressHydrationWarning
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}

      {requestState.status === "ready" ? (
        <CatalogTableResults
          batchEnrichmentActionState={batchEnrichmentActionState}
          data={requestState.data}
          latestCsvExportBatch={latestCsvExportBatch}
          latestHubspotPushBatch={latestHubspotPushBatch}
          onClearSelection={onClearSelection}
          onExportSelectedChannels={onExportSelectedChannels}
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
          onPushSelectedChannelsToHubspot={onPushSelectedChannelsToHubspot}
          onRequestSelectedEnrichment={onRequestSelectedEnrichment}
          onToggleChannelSelection={onToggleChannelSelection}
          onTogglePageSelection={onTogglePageSelection}
          selectedChannelIds={selectedChannelIds}
        />
      ) : null}
    </div>
  );
}

function CatalogTableResults({
  batchEnrichmentActionState,
  data,
  latestCsvExportBatch,
  latestHubspotPushBatch,
  selectedChannelIds,
  onToggleChannelSelection,
  onTogglePageSelection,
  onExportSelectedChannels,
  onPushSelectedChannelsToHubspot,
  onRequestSelectedEnrichment,
  onClearSelection,
  onPreviousPage,
  onNextPage,
}: {
  batchEnrichmentActionState: BatchEnrichmentActionState;
  data: ListChannelsResponse;
  latestCsvExportBatch: CatalogCsvExportBatchState;
  latestHubspotPushBatch: CatalogHubspotPushBatchState;
  selectedChannelIds: readonly string[];
  onToggleChannelSelection: (channelId: string) => void;
  onTogglePageSelection: () => void;
  onExportSelectedChannels: () => void | Promise<void>;
  onPushSelectedChannelsToHubspot: () => void | Promise<void>;
  onRequestSelectedEnrichment: () => void | Promise<void>;
  onClearSelection: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
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

      {hasSelection ? (
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

      {batchEnrichmentActionState.message ? (
        <p
          aria-live="polite"
          className={`catalog-table__selection-status catalog-table__selection-status--${batchEnrichmentActionState.type}`}
          role={batchEnrichmentActionState.type === "error" ? "alert" : undefined}
        >
          {batchEnrichmentActionState.message}
        </p>
      ) : null}

      <CatalogSelectionBatchCards
        latestCsvExportBatch={latestCsvExportBatch}
        latestHubspotPushBatch={latestHubspotPushBatch}
      />

      {!hasChannels ? (
        <p className="catalog-table__feedback catalog-table__feedback--empty">
          {getEmptyCatalogMessage(data)}
        </p>
      ) : (
        <div className="catalog-table__table-wrap">
          <table className="catalog-table__table">
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
                <th scope="col">YouTube Average Views</th>
                <th scope="col">YouTube Engagement Rate</th>
                <th scope="col">YouTube Followers</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((channel) => {
                const isSelected = selectedChannelIds.includes(channel.id);

                return (
                  <tr
                    className={
                      isSelected
                        ? "catalog-table__row catalog-table__row--selected"
                        : "catalog-table__row"
                    }
                    key={channel.id}
                  >
                    <td className="catalog-table__select-cell">
                      <input
                        aria-label={`Select ${channel.title}`}
                        checked={isSelected}
                        onChange={() => {
                          onToggleChannelSelection(channel.id);
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
                          <div
                            className="catalog-table__thumbnail catalog-table__thumbnail--fallback"
                            aria-hidden="true"
                          >
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
                      {channel.socialMediaLink ? (
                        <a
                          className="catalog-table__link"
                          href={channel.socialMediaLink}
                          rel="noreferrer"
                          target="_blank"
                        >
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
                    <td>{formatChannelMetric(channel.youtubeAverageViews ?? null)}</td>
                    <td>{formatChannelEngagementRate(channel.youtubeEngagementRate ?? null)}</td>
                    <td>{formatChannelMetric(channel.youtubeFollowers ?? null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function CatalogTableShell({ pageSize = DEFAULT_PAGE_SIZE }: CatalogTableShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const appliedState = parseCatalogUrlState(searchParams);
  const appliedStateKey = buildCatalogSearchParams(appliedState).toString();
  const [draftFilters, setDraftFilters] = useState<CatalogFiltersState>(appliedState.filters);
  const [requestState, setRequestState] = useState<CatalogTableRequestState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [reloadToken, setReloadToken] = useState(0);
  const [savedSegments, setSavedSegments] = useState<SegmentResponse[]>([]);
  const [savedSegmentsRequestState, setSavedSegmentsRequestState] = useState<SavedSegmentsRequestState>({
    status: "loading",
    error: null,
  });
  const [savedSegmentsReloadToken, setSavedSegmentsReloadToken] = useState(0);
  const [savedSegmentName, setSavedSegmentName] = useState("");
  const [savedSegmentOperationStatus, setSavedSegmentOperationStatus] =
    useState<SavedSegmentOperationStatus>(IDLE_SAVED_SEGMENT_OPERATION_STATUS);
  const [pendingSegmentAction, setPendingSegmentAction] = useState<string | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [batchEnrichmentActionState, setBatchEnrichmentActionState] =
    useState<BatchEnrichmentActionState>(IDLE_BATCH_ENRICHMENT_ACTION_STATE);
  const [latestCsvExportBatch, setLatestCsvExportBatch] =
    useState<CatalogCsvExportBatchState>(IDLE_CSV_EXPORT_BATCH_STATE);
  const [latestCsvExportBatchReloadToken, setLatestCsvExportBatchReloadToken] = useState(0);
  const [latestHubspotPushBatch, setLatestHubspotPushBatch] =
    useState<CatalogHubspotPushBatchState>(IDLE_HUBSPOT_PUSH_BATCH_STATE);
  const [latestHubspotPushBatchReloadToken, setLatestHubspotPushBatchReloadToken] = useState(0);

  useEffect(() => {
    setDraftFilters(appliedState.filters);
  }, [appliedStateKey]);

  useEffect(() => {
    let didCancel = false;
    let activeAbortController: AbortController | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const requestInput = {
      page: appliedState.page,
      pageSize,
      ...(appliedState.filters.query ? { query: appliedState.filters.query } : {}),
      ...(appliedState.filters.enrichmentStatus.length > 0
        ? { enrichmentStatus: appliedState.filters.enrichmentStatus }
        : {}),
      ...(appliedState.filters.advancedReportStatus.length > 0
        ? { advancedReportStatus: appliedState.filters.advancedReportStatus }
        : {}),
    };

    async function loadChannels(polling = false): Promise<void> {
      const abortController = new AbortController();
      activeAbortController = abortController;

      if (!polling) {
        setRequestState({
          status: "loading",
          data: null,
          error: null,
        });
      }

      try {
        const data = await fetchChannels(requestInput, abortController.signal);

        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "ready",
          data,
          error: null,
        });

        if (shouldPollCatalogEnrichmentRows(data)) {
          timeoutId = setTimeout(() => {
            void loadChannels(true);
          }, CATALOG_ENRICHMENT_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "error",
          data: null,
          error:
            error instanceof Error && error.message
              ? error.message
              : "Unable to load channels. Please try again.",
        });
      }
    }

    void loadChannels();

    return () => {
      didCancel = true;
      activeAbortController?.abort();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [appliedStateKey, pageSize, reloadToken]);

  useEffect(() => {
    const abortController = new AbortController();

    setSavedSegmentsRequestState({
      status: "loading",
      error: null,
    });

    void fetchSavedSegments(abortController.signal)
      .then((items) => {
        if (abortController.signal.aborted) {
          return;
        }

        setSavedSegments(sortSavedSegments(items));
        setSavedSegmentsRequestState({
          status: "ready",
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        setSavedSegmentsRequestState({
          status: "error",
          error: getSavedSegmentErrorMessage(error),
        });
      });

    return () => {
      abortController.abort();
    };
  }, [savedSegmentsReloadToken]);

  useEffect(() => {
    const batchId = latestCsvExportBatch.summary?.id ?? latestCsvExportBatch.detail?.id;

    if (!batchId) {
      return;
    }

    const abortController = new AbortController();
    const keepCurrentDetailVisible =
      latestCsvExportBatch.requestState === "ready" &&
      latestCsvExportBatch.detail?.id === batchId;

    if (!keepCurrentDetailVisible) {
      setLatestCsvExportBatch((current) => ({
        ...current,
        requestState: "loading",
        error: null,
        isRefreshing: false,
      }));
    } else {
      setLatestCsvExportBatch((current) => ({
        ...current,
        isRefreshing: true,
      }));
    }

    void fetchCsvExportBatchDetail(batchId, abortController.signal)
      .then((detail) => {
        if (abortController.signal.aborted) {
          return;
        }

        setLatestCsvExportBatch((current) => ({
          requestState: "ready",
          summary: current.summary && current.summary.id === detail.id ? current.summary : detail,
          detail,
          error: null,
          isRefreshing: false,
        }));
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        setLatestCsvExportBatch((current) => ({
          ...current,
          requestState: "error",
          error: getCatalogCsvExportBatchDetailErrorMessage(error),
          isRefreshing: false,
        }));
      });

    return () => {
      abortController.abort();
    };
  }, [latestCsvExportBatch.summary?.id, latestCsvExportBatchReloadToken]);

  useEffect(() => {
    const batchId = latestHubspotPushBatch.summary?.id ?? latestHubspotPushBatch.detail?.id;

    if (!batchId) {
      return;
    }

    const abortController = new AbortController();
    const keepCurrentDetailVisible =
      latestHubspotPushBatch.requestState === "ready" &&
      latestHubspotPushBatch.detail?.id === batchId;

    if (!keepCurrentDetailVisible) {
      setLatestHubspotPushBatch((current) => ({
        ...current,
        requestState: "loading",
        error: null,
        isRefreshing: false,
      }));
    } else {
      setLatestHubspotPushBatch((current) => ({
        ...current,
        isRefreshing: true,
      }));
    }

    void fetchHubspotPushBatchDetail(batchId, abortController.signal)
      .then((detail) => {
        if (abortController.signal.aborted) {
          return;
        }

        setLatestHubspotPushBatch((current) => ({
          requestState: "ready",
          summary: current.summary && current.summary.id === detail.id ? current.summary : detail,
          detail,
          error: null,
          isRefreshing: false,
        }));
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        setLatestHubspotPushBatch((current) => ({
          ...current,
          requestState: "error",
          error: getCatalogHubspotPushBatchDetailErrorMessage(error),
          isRefreshing: false,
        }));
      });

    return () => {
      abortController.abort();
    };
  }, [latestHubspotPushBatch.summary?.id, latestHubspotPushBatchReloadToken]);

  useEffect(() => {
    const shouldPollCsvExportBatch = shouldPollCatalogCsvExportBatch(latestCsvExportBatch);
    const shouldPollHubspotBatch = shouldPollCatalogHubspotPushBatch(latestHubspotPushBatch);

    if (!shouldPollCsvExportBatch && !shouldPollHubspotBatch) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (shouldPollCsvExportBatch) {
        setLatestCsvExportBatchReloadToken((current) => current + 1);
      }

      if (shouldPollHubspotBatch) {
        setLatestHubspotPushBatchReloadToken((current) => current + 1);
      }
    }, CATALOG_BATCH_STATUS_POLL_INTERVAL_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [latestCsvExportBatch, latestHubspotPushBatch]);

  function replaceCatalogState(state: CatalogUrlState): void {
    router.replace(buildCatalogHref(pathname, state));
  }

  async function handleCreateSegment(): Promise<void> {
    const name = savedSegmentName.trim();

    if (!name) {
      return;
    }

    setPendingSegmentAction("create");
    setSavedSegmentOperationStatus(IDLE_SAVED_SEGMENT_OPERATION_STATUS);

    try {
      const created = await createSavedSegment({
        name,
        filters: buildSavedSegmentFilters(draftFilters),
      });

      setSavedSegments((current) => upsertSavedSegment(current, created));
      setSavedSegmentName("");
      setSavedSegmentOperationStatus({
        type: "success",
        message: `Saved segment "${created.name}".`,
      });
    } catch (error) {
      setSavedSegmentOperationStatus({
        type: "error",
        message: getSavedSegmentErrorMessage(error),
      });
    } finally {
      setPendingSegmentAction(null);
    }
  }

  function handleLoadSegment(segment: SegmentResponse): void {
    const filters = getCatalogFiltersFromSavedSegment(segment.filters);

    setDraftFilters(filters);
    setSavedSegmentName(segment.name);
    setSavedSegmentOperationStatus({
      type: "success",
      message: `Loaded segment "${segment.name}".`,
    });
    replaceCatalogState({
      page: 1,
      filters,
    });
  }

  async function handleDeleteSegment(segment: SegmentResponse): Promise<void> {
    setPendingSegmentAction(`delete:${segment.id}`);
    setSavedSegmentOperationStatus(IDLE_SAVED_SEGMENT_OPERATION_STATUS);

    try {
      await deleteSavedSegment(segment.id);
      setSavedSegments((current) => current.filter((item) => item.id !== segment.id));
      setSavedSegmentOperationStatus({
        type: "success",
        message: `Deleted segment "${segment.name}".`,
      });
    } catch (error) {
      setSavedSegmentOperationStatus({
        type: "error",
        message: getSavedSegmentErrorMessage(error),
      });
    } finally {
      setPendingSegmentAction(null);
    }
  }

  async function handleExportSelectedChannels(): Promise<void> {
    if (requestState.status !== "ready") {
      return;
    }

    const channelIds = [...new Set(selectedChannelIds)];

    if (channelIds.length === 0) {
      return;
    }

    setLatestCsvExportBatch({
      requestState: "loading",
      summary: null,
      detail: null,
      error: null,
      isRefreshing: false,
    });

    try {
      const batch = await createCsvExportBatch({
        type: "selected",
        channelIds,
      });

      setLatestCsvExportBatch({
        requestState: "loading",
        summary: batch,
        detail: null,
        error: null,
        isRefreshing: false,
      });
    } catch (error) {
      setLatestCsvExportBatch({
        requestState: "error",
        summary: null,
        detail: null,
        error: getCatalogCsvExportBatchCreateErrorMessage(error),
        isRefreshing: false,
      });
    }
  }

  async function handlePushSelectedChannelsToHubspot(): Promise<void> {
    if (requestState.status !== "ready") {
      return;
    }

    const channelIds = [...new Set(selectedChannelIds)];

    if (channelIds.length === 0) {
      return;
    }

    setLatestHubspotPushBatch({
      requestState: "loading",
      summary: null,
      detail: null,
      error: null,
      isRefreshing: false,
    });

    try {
      const batch = await createHubspotPushBatch({
        channelIds,
      });

      setLatestHubspotPushBatch({
        requestState: "loading",
        summary: batch,
        detail: null,
        error: null,
        isRefreshing: false,
      });
    } catch (error) {
      setLatestHubspotPushBatch({
        requestState: "error",
        summary: null,
        detail: null,
        error: getCatalogHubspotPushBatchCreateErrorMessage(error),
        isRefreshing: false,
      });
    }
  }

  async function handleRequestSelectedEnrichment(): Promise<void> {
    if (requestState.status !== "ready") {
      return;
    }

    const channelIds = [...new Set(selectedChannelIds)];

    if (channelIds.length === 0) {
      return;
    }

    setBatchEnrichmentActionState({
      type: "submitting",
      message: getBatchEnrichmentSubmittingMessage(channelIds.length),
    });

    try {
      const results = await requestChannelEnrichmentBatch(channelIds);
      const hasSuccessfulRequest = results.some(isBatchEnrichmentSuccess);

      if (hasSuccessfulRequest) {
        setRequestState((current) => {
          if (current.status !== "ready") {
            return current;
          }

          return {
            status: "ready",
            data: mergeCatalogBatchEnrichmentResults(current.data, results),
            error: null,
          };
        });
        setReloadToken((current) => current + 1);
      }

      setBatchEnrichmentActionState(summarizeCatalogBatchEnrichmentResults(results));
    } catch (error) {
      setBatchEnrichmentActionState({
        type: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : "Unable to request channel enrichment. Please try again.",
      });
    }
  }

  return (
    <CatalogTableShellView
      batchEnrichmentActionState={batchEnrichmentActionState}
      draftFilters={draftFilters}
      hasPendingFilterChanges={!areCatalogFiltersEqual(draftFilters, appliedState.filters)}
      onClearSelection={() => {
        setSelectedChannelIds([]);
      }}
      onCreateSegment={handleCreateSegment}
      onApplyFilters={() => {
        replaceCatalogState({
          page: 1,
          filters: draftFilters,
        });
      }}
      onDeleteSegment={handleDeleteSegment}
      onDraftQueryChange={(value) => {
        setDraftFilters((current) => ({
          ...current,
          query: value,
        }));
      }}
      onExportSelectedChannels={handleExportSelectedChannels}
      onLoadSegment={handleLoadSegment}
      onNextPage={() => {
        if (requestState.status !== "ready") {
          return;
        }

        const nextPage = getNextCatalogPage(requestState.data);

        if (nextPage === null) {
          return;
        }

        replaceCatalogState({
          page: nextPage,
          filters: appliedState.filters,
        });
      }}
      onPreviousPage={() => {
        if (requestState.status !== "ready") {
          return;
        }

        const previousPage = getPreviousCatalogPage(requestState.data);

        if (previousPage === null) {
          return;
        }

        replaceCatalogState({
          page: previousPage,
          filters: appliedState.filters,
        });
      }}
      onResetFilters={() => {
        setDraftFilters(DEFAULT_CATALOG_FILTERS);
        replaceCatalogState({
          page: 1,
          filters: DEFAULT_CATALOG_FILTERS,
        });
      }}
      onPushSelectedChannelsToHubspot={handlePushSelectedChannelsToHubspot}
      onRequestSelectedEnrichment={handleRequestSelectedEnrichment}
      onRetrySavedSegments={() => {
        setSavedSegmentsReloadToken((current) => current + 1);
      }}
      onRetry={() => {
        setReloadToken((current) => current + 1);
      }}
      onSavedSegmentNameChange={(value) => {
        setSavedSegmentName(value);
      }}
      onToggleChannelSelection={(channelId) => {
        setSelectedChannelIds((current) => toggleCatalogChannelSelection(current, channelId));
      }}
      onTogglePageSelection={() => {
        if (requestState.status !== "ready") {
          return;
        }

        setSelectedChannelIds((current) => toggleCatalogPageSelection(current, requestState.data.items));
      }}
      onToggleAdvancedReportStatus={(value) => {
        setDraftFilters((current) => ({
          ...current,
          advancedReportStatus: toggleCatalogStatusFilter(current.advancedReportStatus, value),
        }));
      }}
      onToggleEnrichmentStatus={(value) => {
        setDraftFilters((current) => ({
          ...current,
          enrichmentStatus: toggleCatalogStatusFilter(current.enrichmentStatus, value),
        }));
      }}
      latestCsvExportBatch={latestCsvExportBatch}
      latestHubspotPushBatch={latestHubspotPushBatch}
      pendingSegmentAction={pendingSegmentAction}
      requestState={requestState}
      savedSegmentName={savedSegmentName}
      savedSegmentOperationStatus={savedSegmentOperationStatus}
      savedSegments={savedSegments}
      savedSegmentsRequestState={savedSegmentsRequestState}
      selectedChannelIds={selectedChannelIds}
    />
  );
}
