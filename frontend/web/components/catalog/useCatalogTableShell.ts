import type {
  ListChannelsResponse,
  SegmentResponse,
} from "@scouting-platform/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  deleteChannelsBatch,
  requestChannelEnrichmentBatch,
  requestFilteredChannelEnrichment,
  fetchChannels,
} from "../../lib/channels-api";
import type { ChannelEnrichmentStatus } from "@scouting-platform/contracts";
import {
  DEFAULT_CATALOG_FILTERS,
  buildCatalogChannelFilters,
  buildCatalogSearchParams,
  buildSavedSegmentFilters,
  getCatalogFiltersFromSavedSegment,
  normalizeCatalogNumericFilterValue,
  parseCatalogUrlState,
  toggleCatalogMultiValueFilter,
  type CatalogCreatorFilterOptions,
  type CatalogEnrichmentFilter,
  type CatalogFiltersState,
  type CatalogMultiValueFilterKey,
  type CatalogNumericFilterKey,
  type CatalogUrlState,
} from "../../lib/catalog-filters";
import { createCsvExportBatch, fetchCsvExportBatchDetail } from "../../lib/csv-export-batches-api";
import { useDocumentVisibility } from "../../lib/document-visibility";
import { createSavedSegment, deleteSavedSegment, fetchSavedSegments } from "../../lib/segments-api";
import type {
  BatchEnrichmentActionState,
  CatalogDeleteActionState,
  CatalogCsvExportBatchState,
  CatalogViewMode,
  SavedSegmentOperationStatus,
  SavedSegmentsRequestState,
} from "./catalog-table-shared";
import {
  getBatchEnrichmentSubmittingMessage,
  getFilteredEnrichmentSubmittingMessage,
  getCatalogChannelDeleteErrorMessage,
  getCatalogChannelDeleteSubmittingMessage,
  getCatalogCsvExportBatchCreateErrorMessage,
  getCatalogCsvExportBatchDetailErrorMessage,
  getNextCatalogPage,
  getPreviousCatalogPage,
  getSavedSegmentErrorMessage,
  isBatchEnrichmentSuccess,
  mergeCatalogBatchEnrichmentResults,
  shouldPollCatalogCsvExportBatch,
  shouldPollCatalogEnrichmentRows,
  sortSavedSegments,
  summarizeCatalogBatchEnrichmentResults,
  summarizeCatalogFilteredEnrichmentResult,
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
  creatorFilterOptions: CatalogCreatorFilterOptions;
  initialData: ListChannelsResponse | undefined;
  initialSavedSegments: SegmentResponse[] | undefined;
  isAdmin?: boolean;
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

const IDLE_DELETE_ACTION_STATE: CatalogDeleteActionState = {
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
  creatorFilterOptions,
  initialData,
  initialSavedSegments,
  isAdmin = false,
  pageSize,
}: UseCatalogTableShellInput) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const parsedState = useMemo(
    () => parseCatalogUrlState(new URLSearchParams(searchParamsKey)),
    [searchParamsKey],
  );
  const appliedStateKey = useMemo(
    () => buildCatalogSearchParams(parsedState).toString(),
    [parsedState],
  );
  const appliedState = useMemo(
    () => parseCatalogUrlState(new URLSearchParams(appliedStateKey)),
    [appliedStateKey],
  );
  const requestEnrichmentStatuses = useMemo((): ChannelEnrichmentStatus[] | undefined => {
    if (appliedState.filters.enrichmentStatus === "enriched") {
      // Enriched = has data (completed or stale — stale channels still have enrichment content).
      return ["completed", "stale"];
    }

    if (appliedState.filters.enrichmentStatus === "not_enriched") {
      // Not enriched = no data at all. Stale channels have data so they are excluded.
      // Queued/running are in-progress; omitting them keeps this filter clean.
      return ["missing", "failed"];
    }

    return undefined;
  }, [appliedState.filters.enrichmentStatus]);

  const requestInput = useMemo(
    () => ({
      page: appliedState.page,
      pageSize,
      ...(appliedState.filters.query ? { query: appliedState.filters.query } : {}),
      ...(appliedState.filters.countryRegion.length > 0
        ? { countryRegion: appliedState.filters.countryRegion }
        : {}),
      ...(appliedState.filters.influencerVertical.length > 0
        ? { influencerVertical: appliedState.filters.influencerVertical }
        : {}),
      ...(appliedState.filters.influencerType.length > 0
        ? { influencerType: appliedState.filters.influencerType }
        : {}),
      ...(appliedState.filters.youtubeVideoMedianViewsMin
        ? { youtubeVideoMedianViewsMin: Number(appliedState.filters.youtubeVideoMedianViewsMin) }
        : {}),
      ...(appliedState.filters.youtubeVideoMedianViewsMax
        ? { youtubeVideoMedianViewsMax: Number(appliedState.filters.youtubeVideoMedianViewsMax) }
        : {}),
      ...(appliedState.filters.youtubeShortsMedianViewsMin
        ? { youtubeShortsMedianViewsMin: Number(appliedState.filters.youtubeShortsMedianViewsMin) }
        : {}),
      ...(appliedState.filters.youtubeShortsMedianViewsMax
        ? { youtubeShortsMedianViewsMax: Number(appliedState.filters.youtubeShortsMedianViewsMax) }
        : {}),
      ...(appliedState.filters.youtubeFollowersMin
        ? { youtubeFollowersMin: Number(appliedState.filters.youtubeFollowersMin) }
        : {}),
      ...(appliedState.filters.youtubeFollowersMax
        ? { youtubeFollowersMax: Number(appliedState.filters.youtubeFollowersMax) }
        : {}),
      ...(requestEnrichmentStatuses ? { enrichmentStatus: requestEnrichmentStatuses } : {}),
    }),
    [appliedState, pageSize, requestEnrichmentStatuses],
  );
  const initialAppliedStateKeyRef = useRef(appliedStateKey);
  const viewMode = getCatalogViewMode(searchParams);
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
  const [deleteActionState, setDeleteActionState] =
    useState<CatalogDeleteActionState>(IDLE_DELETE_ACTION_STATE);
  const [latestCsvExportBatch, setLatestCsvExportBatch] =
    useState<CatalogCsvExportBatchState>(IDLE_CSV_EXPORT_BATCH_STATE);
  const [latestCsvExportBatchReloadToken, setLatestCsvExportBatchReloadToken] = useState(0);
  const isDocumentVisible = useDocumentVisibility();

  useEffect(() => {
    if (viewMode === "cards" && selectedChannelIds.length > 0) {
      setSelectedChannelIds([]);
    }
  }, [selectedChannelIds.length, viewMode]);

  useEffect(() => {
    let didCancel = false;
    let activeAbortController: AbortController | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const canReuseInitialData = reloadToken === 0 && !!initialData && appliedStateKey === initialAppliedStateKeyRef.current;

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
    appliedStateKey,
    initialData,
    isDocumentVisible,
    reloadToken,
    requestInput,
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
    const shouldPollCsvExportBatch = shouldPollCatalogCsvExportBatch(latestCsvExportBatch);

    if (!isDocumentVisible || !shouldPollCsvExportBatch) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (shouldPollCsvExportBatch) {
        setLatestCsvExportBatchReloadToken((current) => current + 1);
      }
    }, CATALOG_BATCH_STATUS_POLL_INTERVAL_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isDocumentVisible, latestCsvExportBatch]);

  function replaceCatalogState(state: CatalogUrlState): void {
    router.replace(buildCatalogNavigationHref(pathname, state, viewMode));
  }

  function applyFilters(nextFilters: CatalogFiltersState): void {
    replaceCatalogState({
      page: 1,
      filters: nextFilters,
    });
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
        filters: buildSavedSegmentFilters(appliedState.filters),
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
      router.push(`/exports/${batch.id}`);
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

  async function handleRequestFilteredEnrichment(): Promise<void> {
    if (requestState.status !== "ready" || requestState.data.total === 0) {
      return;
    }

    const totalCount = requestState.data.total;
    const confirmed = window.confirm(
      `Request enrichment for all ${totalCount} channel${totalCount === 1 ? "" : "s"} matching the current filters?`,
    );

    if (!confirmed) {
      return;
    }

    setBatchEnrichmentActionState({
      type: "submitting",
      message: getFilteredEnrichmentSubmittingMessage(totalCount),
    });

    try {
      const result = await requestFilteredChannelEnrichment(
        buildCatalogChannelFilters(appliedState.filters),
      );

      if (result.queuedCount > 0 || result.alreadyQueuedCount > 0) {
        setReloadToken((current) => current + 1);
      }

      setBatchEnrichmentActionState(summarizeCatalogFilteredEnrichmentResult(result));
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

  async function handleDeleteSelectedChannels(): Promise<void> {
    if (!isAdmin || requestState.status !== "ready") {
      return;
    }

    const channelIds = [...new Set(selectedChannelIds)];

    if (channelIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${channelIds.length} selected channel${channelIds.length === 1 ? "" : "s"}? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setDeleteActionState({
      type: "submitting",
      message: getCatalogChannelDeleteSubmittingMessage(channelIds.length),
    });

    try {
      const result = await deleteChannelsBatch(channelIds);
      const deletedChannelIds = new Set(channelIds);

      setRequestState((current) => {
        if (current.status !== "ready") {
          return current;
        }

        return {
          status: "ready",
          data: {
            ...current.data,
            items: current.data.items.filter((channel) => !deletedChannelIds.has(channel.id)),
            total: Math.max(0, current.data.total - result.deletedCount),
          },
          error: null,
        };
      });
      setSelectedChannelIds((current) => current.filter((channelId) => !deletedChannelIds.has(channelId)));
      setDeleteActionState({
        type: "success",
        message:
          result.deletedCount === 1
            ? "Deleted 1 channel."
            : `Deleted ${result.deletedCount} channels.`,
      });
      setReloadToken((current) => current + 1);
    } catch (error) {
      setDeleteActionState({
        type: "error",
        message: getCatalogChannelDeleteErrorMessage(error),
      });
    }
  }

  return {
    batchEnrichmentActionState,
    creatorFilterOptions,
    deleteActionState,
    filters: appliedState.filters,
    isAdmin,
    latestCsvExportBatch,
    pendingSegmentAction,
    requestState,
    savedSegmentName,
    savedSegmentOperationStatus,
    savedSegments,
    savedSegmentsRequestState,
    selectedChannelIds,
    viewMode,
    onClearSelection: () => {
      setSelectedChannelIds([]);
    },
    onCreateSegment: handleCreateSegment,
    onDeleteSegment: handleDeleteSegment,
    onDeleteSelectedChannels: handleDeleteSelectedChannels,
    onQueryChange: (value: string) => {
      applyFilters({
        ...appliedState.filters,
        query: value,
      });
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
    onRequestFilteredEnrichment: handleRequestFilteredEnrichment,
    onRequestSelectedEnrichment: handleRequestSelectedEnrichment,
    onResetFilters: () => {
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
    onToggleChannelSelection: (channelId: string) => {
      setSelectedChannelIds((current) => toggleCatalogChannelSelection(current, channelId));
    },
    onNumericFilterChange: (key: CatalogNumericFilterKey, value: string) => {
      applyFilters({
        ...appliedState.filters,
        [key]: normalizeCatalogNumericFilterValue(value),
      });
    },
    onClearNumericRangeFilter: (minKey: CatalogNumericFilterKey, maxKey: CatalogNumericFilterKey) => {
      applyFilters({
        ...appliedState.filters,
        [minKey]: "",
        [maxKey]: "",
      });
    },
    onClearMultiValueFilter: (key: CatalogMultiValueFilterKey) => {
      applyFilters({
        ...appliedState.filters,
        [key]: [],
      });
    },
    onToggleMultiValueFilter: (key: CatalogMultiValueFilterKey, value: string) => {
      applyFilters({
        ...appliedState.filters,
        [key]: toggleCatalogMultiValueFilter(appliedState.filters[key], value),
      });
    },
    onEnrichmentStatusChange: (value: CatalogEnrichmentFilter | "") => {
      applyFilters({
        ...appliedState.filters,
        enrichmentStatus: value,
      });
    },
    onTogglePageSelection: () => {
      if (requestState.status !== "ready") {
        return;
      }

      setSelectedChannelIds((current) => toggleCatalogPageSelection(current, requestState.data.items));
    },
  };
}
