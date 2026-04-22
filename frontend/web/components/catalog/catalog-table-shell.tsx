"use client";

import type {
  ListChannelsResponse,
  SegmentResponse,
} from "@scouting-platform/contracts";
import React from "react";

import {
  EMPTY_CATALOG_CREATOR_FILTER_OPTIONS,
  areCatalogFiltersEqual,
  buildCatalogHref,
  buildCatalogSearchParams,
  buildSavedSegmentFilters,
  countActiveCatalogFilters,
  formatSavedSegmentSummary,
  getCatalogFiltersFromSavedSegment,
  normalizeCatalogFilters,
  normalizeCatalogNumericFilterValue,
  parseCatalogUrlState,
  toggleCatalogMultiValueFilter,
  type CatalogCreatorFilterOptions,
  type CatalogFiltersState,
  type CatalogMultiValueFilterKey,
  type CatalogNumericFilterKey,
} from "../../lib/catalog-filters";
import { CatalogBatchCards } from "./CatalogBatchCards";
import { CatalogFilters } from "./CatalogFilters";
import { CatalogTable } from "./CatalogTable";
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
  getCatalogEnrichmentDetailCopy,
  getEmptyCatalogMessage,
  getNextCatalogPage,
  getPreviousCatalogPage,
  hasNextCatalogPage,
  hasPreviousCatalogPage,
  mergeCatalogBatchEnrichmentResults,
  shouldPollCatalogCsvExportBatch,
  shouldPollCatalogEnrichmentRows,
  shouldPollCatalogHubspotPushBatch,
  summarizeCatalogBatchEnrichmentResults,
  toggleCatalogChannelSelection,
  toggleCatalogPageSelection,
} from "./catalog-table-shared";
import {
  CATALOG_BATCH_STATUS_POLL_INTERVAL_MS,
  CATALOG_ENRICHMENT_POLL_INTERVAL_MS,
  DEFAULT_PAGE_SIZE,
  type CatalogTableRequestState,
  useCatalogTableShellModel,
} from "./useCatalogTableShell";

export {
  areAllCatalogPageRowsSelected,
  areCatalogFiltersEqual,
  buildCatalogHref,
  buildCatalogSearchParams,
  buildSavedSegmentFilters,
  countActiveCatalogFilters,
  countSelectedCatalogPageRows,
  formatCatalogSelectionSummary,
  formatChannelCountSummary,
  formatSavedSegmentSummary,
  getCatalogEnrichmentDetailCopy,
  getCatalogFiltersFromSavedSegment,
  getEmptyCatalogMessage,
  getNextCatalogPage,
  getPreviousCatalogPage,
  hasNextCatalogPage,
  hasPreviousCatalogPage,
  mergeCatalogBatchEnrichmentResults,
  normalizeCatalogFilters,
  normalizeCatalogNumericFilterValue,
  parseCatalogUrlState,
  shouldPollCatalogCsvExportBatch,
  shouldPollCatalogEnrichmentRows,
  shouldPollCatalogHubspotPushBatch,
  summarizeCatalogBatchEnrichmentResults,
  toggleCatalogChannelSelection,
  toggleCatalogMultiValueFilter,
  toggleCatalogPageSelection,
};

type CatalogTableShellProps = {
  pageSize?: number;
  initialData?: ListChannelsResponse;
  initialSavedSegments?: SegmentResponse[];
  creatorFilterOptions?: CatalogCreatorFilterOptions;
};

type CatalogTableShellViewProps = {
  creatorFilterOptions: CatalogCreatorFilterOptions;
  draftFilters: CatalogFiltersState;
  requestState: CatalogTableRequestState;
  selectedChannelIds: readonly string[];
  batchEnrichmentActionState: BatchEnrichmentActionState;
  latestCsvExportBatch: CatalogCsvExportBatchState;
  latestHubspotPushBatch: CatalogHubspotPushBatchState;
  hasPendingFilterChanges: boolean;
  viewMode?: CatalogViewMode;
  onDraftQueryChange: (value: string) => void;
  onNumericFilterChange: (key: CatalogNumericFilterKey, value: string) => void;
  onToggleMultiValueFilter: (key: CatalogMultiValueFilterKey, value: string) => void;
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

export { CATALOG_BATCH_STATUS_POLL_INTERVAL_MS, CATALOG_ENRICHMENT_POLL_INTERVAL_MS };

export function CatalogTableShellView({
  creatorFilterOptions,
  draftFilters,
  requestState,
  selectedChannelIds,
  batchEnrichmentActionState,
  latestCsvExportBatch,
  latestHubspotPushBatch,
  hasPendingFilterChanges,
  viewMode = "table",
  onDraftQueryChange,
  onNumericFilterChange,
  onToggleMultiValueFilter,
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
  const searchOptions =
    requestState.status === "ready"
      ? requestState.data.items.map((channel) => ({
          value: channel.title,
          label: channel.title,
          meta: [channel.handle, channel.youtubeChannelId].filter(Boolean).join(" · "),
        }))
      : [];

  return (
    <div className="catalog-table">
      <div className="catalog-layout">
        <div className="catalog-layout__rail-stack">
          <CatalogFilters
            creatorFilterOptions={creatorFilterOptions}
            draftFilters={draftFilters}
            hasPendingFilterChanges={hasPendingFilterChanges}
            searchOptions={searchOptions}
            onApplyFilters={onApplyFilters}
            onDraftQueryChange={onDraftQueryChange}
            onNumericFilterChange={onNumericFilterChange}
            onResetFilters={onResetFilters}
            onToggleMultiValueFilter={onToggleMultiValueFilter}
          />
        </div>

        <div className="catalog-layout__content">
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
            <>
              <CatalogBatchCards
                latestCsvExportBatch={latestCsvExportBatch}
                latestHubspotPushBatch={latestHubspotPushBatch}
              />
              <CatalogTable
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
                viewMode={viewMode}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CatalogTableShell({
  creatorFilterOptions = EMPTY_CATALOG_CREATOR_FILTER_OPTIONS,
  pageSize = DEFAULT_PAGE_SIZE,
  initialData,
  initialSavedSegments,
}: CatalogTableShellProps) {
  const model = useCatalogTableShellModel({
    creatorFilterOptions,
    initialData,
    initialSavedSegments,
    pageSize,
  });

  return <CatalogTableShellView {...model} />;
}
