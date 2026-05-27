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
  formatSavedSegmentSummary,
  getCatalogFiltersFromSavedSegment,
  parseCatalogUrlState,
  toggleCatalogMultiValueFilter,
  type CatalogCreatorFilterOptions,
  type CatalogFiltersState,
  type CatalogMultiValueFilterKey,
  type CatalogNumericFilterKey,
} from "../../lib/catalog-filters";
import { CatalogFilters } from "./CatalogFilters";
import { CatalogTable } from "./CatalogTable";
import type {
  BatchEnrichmentActionState,
  CatalogDeleteActionState,
  CatalogCsvExportBatchState,
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
  parseCatalogUrlState,
  shouldPollCatalogCsvExportBatch,
  shouldPollCatalogEnrichmentRows,
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
  isAdmin?: boolean;
};

type CatalogTableShellViewProps = {
  creatorFilterOptions: CatalogCreatorFilterOptions;
  filters: CatalogFiltersState;
  requestState: CatalogTableRequestState;
  selectedChannelIds: readonly string[];
  batchEnrichmentActionState: BatchEnrichmentActionState;
  deleteActionState: CatalogDeleteActionState;
  latestCsvExportBatch: CatalogCsvExportBatchState;
  isAdmin?: boolean;
  viewMode?: CatalogViewMode;
  onQueryChange: (value: string) => void;
  onNumericFilterChange: (key: CatalogNumericFilterKey, value: string) => void;
  onClearNumericRangeFilter: (minKey: CatalogNumericFilterKey, maxKey: CatalogNumericFilterKey) => void;
  onClearMultiValueFilter: (key: CatalogMultiValueFilterKey) => void;
  onToggleMultiValueFilter: (key: CatalogMultiValueFilterKey, value: string) => void;
  onToggleChannelSelection: (channelId: string) => void;
  onTogglePageSelection: () => void;
  onExportSelectedChannels: () => void | Promise<void>;
  onDeleteSelectedChannels: () => void | Promise<void>;
  onRequestFilteredEnrichment: () => void | Promise<void>;
  onRequestSelectedEnrichment: () => void | Promise<void>;
  onClearSelection: () => void;
  onResetFilters: () => void;
  onRetry: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
};

export { CATALOG_BATCH_STATUS_POLL_INTERVAL_MS, CATALOG_ENRICHMENT_POLL_INTERVAL_MS };

export function CatalogTableShellView({
  creatorFilterOptions,
  filters,
  requestState,
  selectedChannelIds,
  batchEnrichmentActionState,
  deleteActionState,
  latestCsvExportBatch,
  isAdmin = false,
  viewMode = "table",
  onQueryChange,
  onNumericFilterChange,
  onClearNumericRangeFilter,
  onClearMultiValueFilter,
  onToggleMultiValueFilter,
  onToggleChannelSelection,
  onTogglePageSelection,
  onExportSelectedChannels,
  onDeleteSelectedChannels,
  onRequestFilteredEnrichment,
  onRequestSelectedEnrichment,
  onClearSelection,
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
      <CatalogFilters
        creatorFilterOptions={creatorFilterOptions}
        filters={filters}
        searchOptions={searchOptions}
        onClearMultiValueFilter={onClearMultiValueFilter}
        onClearNumericRangeFilter={onClearNumericRangeFilter}
        onNumericFilterChange={onNumericFilterChange}
        onQueryChange={onQueryChange}
        onResetFilters={onResetFilters}
        onToggleMultiValueFilter={onToggleMultiValueFilter}
      />

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
        <CatalogTable
          batchEnrichmentActionState={batchEnrichmentActionState}
          data={requestState.data}
          deleteActionState={deleteActionState}
          isAdmin={isAdmin}
          latestCsvExportBatch={latestCsvExportBatch}
          onClearSelection={onClearSelection}
          onDeleteSelectedChannels={onDeleteSelectedChannels}
          onExportSelectedChannels={onExportSelectedChannels}
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
          onRequestFilteredEnrichment={onRequestFilteredEnrichment}
          onRequestSelectedEnrichment={onRequestSelectedEnrichment}
          onToggleChannelSelection={onToggleChannelSelection}
          onTogglePageSelection={onTogglePageSelection}
          selectedChannelIds={selectedChannelIds}
          viewMode={viewMode}
        />
      ) : null}
    </div>
  );
}

export function CatalogTableShell({
  creatorFilterOptions = EMPTY_CATALOG_CREATOR_FILTER_OPTIONS,
  pageSize = DEFAULT_PAGE_SIZE,
  initialData,
  initialSavedSegments,
  isAdmin = false,
}: CatalogTableShellProps) {
  const model = useCatalogTableShellModel({
    creatorFilterOptions,
    initialData,
    initialSavedSegments,
    isAdmin,
    pageSize,
  });

  return <CatalogTableShellView {...model} />;
}
