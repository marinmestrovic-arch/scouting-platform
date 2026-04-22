import type {
  ChannelEnrichmentDetail,
  ChannelSummary,
  CsvExportBatchDetail,
  CsvExportBatchStatus,
  CsvExportBatchSummary,
  HubspotPushBatchDetail,
  HubspotPushBatchRow,
  HubspotPushBatchStatus,
  HubspotPushBatchSummary,
  ListChannelsResponse,
  SegmentResponse,
} from "@scouting-platform/contracts";

import type { BatchChannelEnrichmentRequestResult } from "../../lib/channels-api";

export type SavedSegmentsRequestState =
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

export type SavedSegmentOperationStatus = {
  type: "idle" | "success" | "error";
  message: string;
};

export type BatchEnrichmentActionState = {
  type: "idle" | "submitting" | "success" | "error";
  message: string;
};

export type CatalogCsvExportBatchState = {
  requestState: "idle" | "loading" | "ready" | "error";
  summary: CsvExportBatchSummary | null;
  detail: CsvExportBatchDetail | null;
  error: string | null;
  isRefreshing: boolean;
};

export type CatalogHubspotPushBatchState = {
  requestState: "idle" | "loading" | "ready" | "error";
  summary: HubspotPushBatchSummary | null;
  detail: HubspotPushBatchDetail | null;
  error: string | null;
  isRefreshing: boolean;
};

type CatalogPaginationState = Pick<ListChannelsResponse, "page" | "pageSize" | "total">;

export type CatalogViewMode = "table" | "cards";

export function formatCatalogTimestamp(value: string | null): string | null {
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

export function getChannelHandle(channel: ChannelSummary): string {
  return channel.handle?.trim() || "No handle";
}

export function formatChannelMetric(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue)) {
    return value;
  }

  return new Intl.NumberFormat("en-US").format(parsedValue);
}

export function formatChannelEngagementRate(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  return `${value.toFixed(1)}%`;
}

export function getIdentityFallback(channel: ChannelSummary): string {
  return channel.title.trim().charAt(0).toUpperCase() || "?";
}

export function sortSavedSegments(segments: readonly SegmentResponse[]): SegmentResponse[] {
  return [...segments].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function upsertSavedSegment(
  segments: readonly SegmentResponse[],
  segment: SegmentResponse,
): SegmentResponse[] {
  return sortSavedSegments([segment, ...segments.filter((item) => item.id !== segment.id)]);
}

export function getSavedSegmentErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to manage saved segments. Please try again.";
}

export function getCatalogCsvExportBatchCreateErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to create the CSV export batch. Please try again.";
}

export function getCatalogCsvExportBatchDetailErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to load CSV export batch status. Please try again.";
}

export function getCatalogHubspotPushBatchCreateErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to create the HubSpot push batch. Please try again.";
}

export function getCatalogHubspotPushBatchDetailErrorMessage(error: unknown): string {
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

export function getCatalogBatchStatusLabel(status: string): string {
  return toTitleCase(status);
}

export function getCsvExportBatchSnapshot(
  state: CatalogCsvExportBatchState,
): CsvExportBatchSummary | CsvExportBatchDetail | null {
  return state.detail ?? state.summary;
}

export function getHubspotPushBatchSnapshot(
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

export function getCsvExportBatchTimestamp(state: CatalogCsvExportBatchState): string | null {
  const batch = getCsvExportBatchSnapshot(state);

  if (!batch) {
    return null;
  }

  return formatCatalogTimestamp(batch.completedAt ?? batch.updatedAt);
}

export function getHubspotPushBatchTimestamp(state: CatalogHubspotPushBatchState): string | null {
  const batch = getHubspotPushBatchSnapshot(state);

  if (!batch) {
    return null;
  }

  return formatCatalogTimestamp(batch.completedAt ?? batch.updatedAt);
}

export function formatSelectedChannelCount(count: number): string {
  return `${count} channel${count === 1 ? "" : "s"}`;
}

function ensureTerminalPunctuation(message: string): string {
  const trimmed = message.trim();

  if (!trimmed) {
    return trimmed;
  }

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function getCsvExportBatchSummaryCopy(state: CatalogCsvExportBatchState): string {
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

export function getHubspotPushBatchSummaryCopy(state: CatalogHubspotPushBatchState): string {
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

export function getFailedHubspotPushRows(state: CatalogHubspotPushBatchState): HubspotPushBatchRow[] {
  return state.detail?.rows.filter((row) => row.status === "failed") ?? [];
}

export function getHubspotPushFailedRowLabel(row: HubspotPushBatchRow): string {
  const identity = row.contactEmail?.trim() ? row.contactEmail : row.channelId;

  return `${identity}: ${ensureTerminalPunctuation(
    row.errorMessage ?? "Unknown HubSpot row failure",
  )}`;
}

export function getBatchEnrichmentSubmittingMessage(selectedCount: number): string {
  return `Requesting enrichment for ${formatSelectedChannelCount(selectedCount)}.`;
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

export function isBatchEnrichmentSuccess(
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
