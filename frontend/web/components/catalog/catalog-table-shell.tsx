"use client";

import type {
  ChannelAdvancedReportStatus,
  ChannelEnrichmentStatus,
  ListChannelsResponse,
  SegmentResponse,
} from "@scouting-platform/contracts";
import React from "react";

import {
  ADVANCED_REPORT_FILTER_OPTIONS,
  ENRICHMENT_FILTER_OPTIONS,
  areCatalogFiltersEqual,
  buildCatalogHref,
  buildCatalogSearchParams,
  buildSavedSegmentFilters,
  formatSavedSegmentSummary,
  getCatalogFiltersFromSavedSegment,
  normalizeCatalogFilters,
  parseCatalogUrlState,
  toggleCatalogStatusFilter,
  type CatalogFiltersState,
} from "../../lib/catalog-filters";
import { CatalogBatchCards } from "./CatalogBatchCards";
import { CatalogFilters } from "./CatalogFilters";
import { CatalogSegments } from "./CatalogSegments";
import { CatalogTable } from "./CatalogTable";
import type {
  BatchEnrichmentActionState,
  CatalogCsvExportBatchState,
  CatalogHubspotPushBatchState,
  CatalogViewMode,
  SavedSegmentOperationStatus,
  SavedSegmentsRequestState,
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
  ADVANCED_REPORT_FILTER_OPTIONS,
  ENRICHMENT_FILTER_OPTIONS,
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
  normalizeCatalogFilters,
  parseCatalogUrlState,
  shouldPollCatalogCsvExportBatch,
  shouldPollCatalogEnrichmentRows,
  shouldPollCatalogHubspotPushBatch,
  summarizeCatalogBatchEnrichmentResults,
  toggleCatalogChannelSelection,
  toggleCatalogPageSelection,
  toggleCatalogStatusFilter,
};

type CatalogTableShellProps = {
  pageSize?: number;
  initialData?: ListChannelsResponse;
  initialSavedSegments?: SegmentResponse[];
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
  viewMode?: CatalogViewMode;
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

export { CATALOG_BATCH_STATUS_POLL_INTERVAL_MS, CATALOG_ENRICHMENT_POLL_INTERVAL_MS };

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
  viewMode = "table",
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
  return (
    <div className="catalog-table">
      <div className="catalog-layout">
        <div className="catalog-layout__rail-stack">
          <CatalogFilters
            draftFilters={draftFilters}
            hasPendingFilterChanges={hasPendingFilterChanges}
            onApplyFilters={onApplyFilters}
            onDraftQueryChange={onDraftQueryChange}
            onResetFilters={onResetFilters}
            onToggleAdvancedReportStatus={onToggleAdvancedReportStatus}
            onToggleEnrichmentStatus={onToggleEnrichmentStatus}
          />
          <CatalogSegments
            pendingSegmentAction={pendingSegmentAction}
            savedSegmentName={savedSegmentName}
            savedSegmentOperationStatus={savedSegmentOperationStatus}
            savedSegments={savedSegments}
            savedSegmentsRequestState={savedSegmentsRequestState}
            onCreateSegment={onCreateSegment}
            onDeleteSegment={onDeleteSegment}
            onLoadSegment={onLoadSegment}
            onRetrySavedSegments={onRetrySavedSegments}
            onSavedSegmentNameChange={onSavedSegmentNameChange}
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
  pageSize = DEFAULT_PAGE_SIZE,
  initialData,
  initialSavedSegments,
}: CatalogTableShellProps) {
  const model = useCatalogTableShellModel({
    initialData,
    initialSavedSegments,
    pageSize,
  });

  return <CatalogTableShellView {...model} />;
}
