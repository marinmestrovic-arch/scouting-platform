import type {
  ChannelAdvancedReportStatus,
  ChannelEnrichmentStatus,
  ListChannelsResponse,
  SegmentResponse,
} from "@scouting-platform/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { requestChannelEnrichmentBatch, fetchChannels } from "../../lib/channels-api";
import {
  DEFAULT_CATALOG_FILTERS,
  areCatalogFiltersEqual,
  buildCatalogSearchParams,
  buildSavedSegmentFilters,
  getCatalogFiltersFromSavedSegment,
  parseCatalogUrlState,
  toggleCatalogStatusFilter,
  type CatalogFiltersState,
  type CatalogUrlState,
} from "../../lib/catalog-filters";
import { createCsvExportBatch, fetchCsvExportBatchDetail } from "../../lib/csv-export-batches-api";
import { useDocumentVisibility } from "../../lib/document-visibility";
import { createHubspotPushBatch, fetchHubspotPushBatchDetail } from "../../lib/hubspot-push-batches-api";
import { createSavedSegment, deleteSavedSegment, fetchSavedSegments } from "../../lib/segments-api";
import type {
  BatchEnrichmentActionState,
  CatalogCsvExportBatchState,
  CatalogHubspotPushBatchState,
  CatalogViewMode,
  SavedSegmentOperationStatus,
  SavedSegmentsRequestState,
} from "./catalog-table-shared";
import {
  getBatchEnrichmentSubmittingMessage,
  getCatalogCsvExportBatchCreateErrorMessage,
  getCatalogCsvExportBatchDetailErrorMessage,
  getCatalogHubspotPushBatchCreateErrorMessage,
  getCatalogHubspotPushBatchDetailErrorMessage,
  getNextCatalogPage,
  getPreviousCatalogPage,
  getSavedSegmentErrorMessage,
  isBatchEnrichmentSuccess,
  mergeCatalogBatchEnrichmentResults,
  shouldPollCatalogCsvExportBatch,
  shouldPollCatalogEnrichmentRows,
  shouldPollCatalogHubspotPushBatch,
  sortSavedSegments,
  summarizeCatalogBatchEnrichmentResults,
  toggleCatalogChannelSelection,
  toggleCatalogPageSelection,
  upsertSavedSegment,
} from "./catalog-table-shared";

export type CatalogTableRequestState =
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

type UseCatalogTableShellInput = Readonly<{
  initialData: ListChannelsResponse | undefined;
  initialSavedSegments: SegmentResponse[] | undefined;
  pageSize: number;
}>;

export const DEFAULT_PAGE_SIZE = 20;
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

function getCatalogViewMode(
  searchParams: Pick<URLSearchParams, "get">,
): CatalogViewMode {
  return searchParams.get("view") === "cards" ? "cards" : "table";
}

function buildCatalogNavigationHref(
  pathname: string,
  state: CatalogUrlState,
  viewMode: CatalogViewMode,
): string {
  const params = buildCatalogSearchParams(state);

  if (viewMode === "cards") {
    params.set("view", "cards");
  }

  const search = params.toString();

  return search ? `${pathname}?${search}` : pathname;
}

export function useCatalogTableShellModel({
  initialData,
  initialSavedSegments,
  pageSize,
}: UseCatalogTableShellInput) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const appliedState = parseCatalogUrlState(searchParams);
  const appliedStateKey = buildCatalogSearchParams(appliedState).toString();
  const viewMode = getCatalogViewMode(searchParams);
  const [draftFilters, setDraftFilters] = useState<CatalogFiltersState>(appliedState.filters);
  const [requestState, setRequestState] = useState<CatalogTableRequestState>(
    initialData
      ? {
          status: "ready",
          data: initialData,
          error: null,
        }
      : {
          status: "loading",
          data: null,
          error: null,
        },
  );
  const [reloadToken, setReloadToken] = useState(0);
  const [savedSegments, setSavedSegments] = useState<SegmentResponse[]>(initialSavedSegments ?? []);
  const [savedSegmentsRequestState, setSavedSegmentsRequestState] = useState<SavedSegmentsRequestState>(
    initialSavedSegments
      ? {
          status: "ready",
          error: null,
        }
      : {
          status: "loading",
          error: null,
        },
  );
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
  const isDocumentVisible = useDocumentVisibility();

  useEffect(() => {
    setDraftFilters((current) => {
      if (areCatalogFiltersEqual(current, appliedState.filters)) {
        return current;
      }

      return appliedState.filters;
    });
  }, [appliedState.filters, appliedStateKey]);

  useEffect(() => {
    if (viewMode === "cards" && selectedChannelIds.length > 0) {
      setSelectedChannelIds([]);
    }
  }, [selectedChannelIds.length, viewMode]);

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
    const canReuseInitialData = reloadToken === 0 && !!initialData;

    async function loadChannels(polling = false): Promise<void> {
      const abortController = new AbortController();
      activeAbortController = abortController;

      if (!polling && !canReuseInitialData) {
        setRequestState({
          status: "loading",
          data: null,
          error: null,
        });
      }

      try {
        const data =
          canReuseInitialData && !polling ? initialData : await fetchChannels(requestInput, abortController.signal);

        if (!data) {
          return;
        }

        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "ready",
          data,
          error: null,
        });

        if (isDocumentVisible && shouldPollCatalogEnrichmentRows(data)) {
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
  }, [
    appliedState.filters.advancedReportStatus,
    appliedState.filters.enrichmentStatus,
    appliedState.filters.query,
    appliedState.page,
    appliedStateKey,
    initialData,
    isDocumentVisible,
    pageSize,
    reloadToken,
  ]);

  useEffect(() => {
    const abortController = new AbortController();
    const canReuseInitialSavedSegments = savedSegmentsReloadToken === 0 && !!initialSavedSegments;

    if (!canReuseInitialSavedSegments) {
      setSavedSegmentsRequestState({
        status: "loading",
        error: null,
      });
    } else {
      setSavedSegments(sortSavedSegments(initialSavedSegments));
      setSavedSegmentsRequestState({
        status: "ready",
        error: null,
      });
    }

    if (canReuseInitialSavedSegments) {
      return () => {
        abortController.abort();
      };
    }

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
  }, [initialSavedSegments, savedSegmentsReloadToken]);

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
  }, [
    latestCsvExportBatch.detail?.id,
    latestCsvExportBatch.requestState,
    latestCsvExportBatch.summary?.id,
    latestCsvExportBatchReloadToken,
  ]);

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
  }, [
    latestHubspotPushBatch.detail?.id,
    latestHubspotPushBatch.requestState,
    latestHubspotPushBatch.summary?.id,
    latestHubspotPushBatchReloadToken,
  ]);

  useEffect(() => {
    const shouldPollCsvExportBatch = shouldPollCatalogCsvExportBatch(latestCsvExportBatch);
    const shouldPollHubspotBatch = shouldPollCatalogHubspotPushBatch(latestHubspotPushBatch);

    if (!isDocumentVisible || (!shouldPollCsvExportBatch && !shouldPollHubspotBatch)) {
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
  }, [isDocumentVisible, latestCsvExportBatch, latestHubspotPushBatch]);

  function replaceCatalogState(state: CatalogUrlState): void {
    router.replace(buildCatalogNavigationHref(pathname, state, viewMode));
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

  return {
    batchEnrichmentActionState,
    draftFilters,
    hasPendingFilterChanges: !areCatalogFiltersEqual(draftFilters, appliedState.filters),
    latestCsvExportBatch,
    latestHubspotPushBatch,
    pendingSegmentAction,
    requestState,
    savedSegmentName,
    savedSegmentOperationStatus,
    savedSegments,
    savedSegmentsRequestState,
    selectedChannelIds,
    viewMode,
    onApplyFilters: () => {
      replaceCatalogState({
        page: 1,
        filters: draftFilters,
      });
    },
    onClearSelection: () => {
      setSelectedChannelIds([]);
    },
    onCreateSegment: handleCreateSegment,
    onDeleteSegment: handleDeleteSegment,
    onDraftQueryChange: (value: string) => {
      setDraftFilters((current) => ({
        ...current,
        query: value,
      }));
    },
    onExportSelectedChannels: handleExportSelectedChannels,
    onLoadSegment: handleLoadSegment,
    onNextPage: () => {
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
    },
    onPreviousPage: () => {
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
    },
    onPushSelectedChannelsToHubspot: handlePushSelectedChannelsToHubspot,
    onRequestSelectedEnrichment: handleRequestSelectedEnrichment,
    onResetFilters: () => {
      setDraftFilters(DEFAULT_CATALOG_FILTERS);
      replaceCatalogState({
        page: 1,
        filters: DEFAULT_CATALOG_FILTERS,
      });
    },
    onRetry: () => {
      setReloadToken((current) => current + 1);
    },
    onRetrySavedSegments: () => {
      setSavedSegmentsReloadToken((current) => current + 1);
    },
    onSavedSegmentNameChange: (value: string) => {
      setSavedSegmentName(value);
    },
    onToggleAdvancedReportStatus: (value: ChannelAdvancedReportStatus) => {
      setDraftFilters((current) => ({
        ...current,
        advancedReportStatus: toggleCatalogStatusFilter(current.advancedReportStatus, value),
      }));
    },
    onToggleChannelSelection: (channelId: string) => {
      setSelectedChannelIds((current) => toggleCatalogChannelSelection(current, channelId));
    },
    onToggleEnrichmentStatus: (value: ChannelEnrichmentStatus) => {
      setDraftFilters((current) => ({
        ...current,
        enrichmentStatus: toggleCatalogStatusFilter(current.enrichmentStatus, value),
      }));
    },
    onTogglePageSelection: () => {
      if (requestState.status !== "ready") {
        return;
      }

      setSelectedChannelIds((current) => toggleCatalogPageSelection(current, requestState.data.items));
    },
  };
}
