"use client";

import type {
  CatalogChannelFilters,
  ChannelAdvancedReportStatus,
  ChannelEnrichmentStatus,
  ChannelSummary,
  ListChannelsResponse,
  SegmentFilters,
  SegmentResponse,
} from "@scouting-platform/contracts";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";

import { fetchChannels } from "../../lib/channels-api";
import {
  createSavedSegment,
  deleteSavedSegment,
  fetchSavedSegments,
} from "../../lib/segments-api";

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

type CatalogFiltersState = {
  query: string;
  enrichmentStatus: ChannelEnrichmentStatus[];
  advancedReportStatus: ChannelAdvancedReportStatus[];
};

type CatalogFilterInput = Pick<CatalogChannelFilters, "query"> & {
  enrichmentStatus?: readonly string[];
  advancedReportStatus?: readonly string[];
};

type CatalogUrlState = {
  page: number;
  filters: CatalogFiltersState;
};

type CatalogFilterOption<T extends string> = {
  value: T;
  label: string;
};

type CatalogTableShellViewProps = {
  draftFilters: CatalogFiltersState;
  requestState: CatalogTableRequestState;
  savedSegments: SegmentResponse[];
  savedSegmentsRequestState: SavedSegmentsRequestState;
  savedSegmentName: string;
  savedSegmentOperationStatus: SavedSegmentOperationStatus;
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
  onApplyFilters: () => void;
  onResetFilters: () => void;
  onRetry: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
};

const DEFAULT_PAGE_SIZE = 20;

const ENRICHMENT_FILTER_OPTIONS: ReadonlyArray<CatalogFilterOption<ChannelEnrichmentStatus>> = [
  { value: "missing", label: "Missing" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Ready" },
  { value: "failed", label: "Failed" },
  { value: "stale", label: "Stale" },
];

const ADVANCED_REPORT_FILTER_OPTIONS: ReadonlyArray<
  CatalogFilterOption<ChannelAdvancedReportStatus>
> = [
  { value: "missing", label: "Missing" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "stale", label: "Stale" },
];

const DEFAULT_FILTERS: CatalogFiltersState = {
  query: "",
  enrichmentStatus: [],
  advancedReportStatus: [],
};

const IDLE_SAVED_SEGMENT_OPERATION_STATUS: SavedSegmentOperationStatus = {
  type: "idle",
  message: "",
};

const ENRICHMENT_FILTER_LABELS = new Map(
  ENRICHMENT_FILTER_OPTIONS.map((option) => [option.value, option.label]),
);

const ADVANCED_REPORT_FILTER_LABELS = new Map(
  ADVANCED_REPORT_FILTER_OPTIONS.map((option) => [option.value, option.label]),
);

type CatalogPaginationState = Pick<ListChannelsResponse, "page" | "pageSize" | "total">;

function getEnrichmentLabel(channel: ChannelSummary): string {
  switch (channel.enrichment.status) {
    case "completed":
      return "Ready";
    case "failed":
      return "Failed";
    case "missing":
      return "Missing";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "stale":
      return "Stale";
    default:
      return channel.enrichment.status;
  }
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

function getIdentityFallback(channel: ChannelSummary): string {
  return channel.title.trim().charAt(0).toUpperCase() || "?";
}

function isPositiveInteger(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0;
}

function normalizeFilterValues<T extends string>(
  values: readonly string[],
  options: ReadonlyArray<CatalogFilterOption<T>>,
): T[] {
  const allowed = new Set(options.map((option) => option.value));
  const selected = new Set(values.filter((value): value is T => allowed.has(value as T)));

  return options
    .map((option) => option.value)
    .filter((value) => selected.has(value));
}

export function normalizeCatalogFilters(filters: CatalogFilterInput): CatalogFiltersState {
  return {
    query: filters.query?.trim() ?? "",
    enrichmentStatus: normalizeFilterValues(
      filters.enrichmentStatus ?? [],
      ENRICHMENT_FILTER_OPTIONS,
    ),
    advancedReportStatus: normalizeFilterValues(
      filters.advancedReportStatus ?? [],
      ADVANCED_REPORT_FILTER_OPTIONS,
    ),
  };
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function buildSavedSegmentFilters(filters: CatalogFiltersState): SegmentFilters {
  const normalized = normalizeCatalogFilters(filters);
  const savedFilters: SegmentFilters = {};

  if (normalized.query) {
    savedFilters.query = normalized.query;
  }

  if (normalized.enrichmentStatus.length > 0) {
    savedFilters.enrichmentStatus = [...normalized.enrichmentStatus];
  }

  if (normalized.advancedReportStatus.length > 0) {
    savedFilters.advancedReportStatus = [...normalized.advancedReportStatus];
  }

  return savedFilters;
}

export function getCatalogFiltersFromSavedSegment(filters: SegmentFilters): CatalogFiltersState {
  return normalizeCatalogFilters({
    query: typeof filters.query === "string" ? filters.query : undefined,
    enrichmentStatus: getStringArray(filters.enrichmentStatus),
    advancedReportStatus: getStringArray(filters.advancedReportStatus),
  });
}

function formatStatusLabels<T extends string>(
  values: readonly T[],
  labels: ReadonlyMap<T, string>,
): string {
  return values.map((value) => labels.get(value) ?? value).join(", ");
}

export function formatSavedSegmentSummary(filters: SegmentFilters): string {
  const catalogFilters = getCatalogFiltersFromSavedSegment(filters);
  const summaryParts: string[] = [];

  if (catalogFilters.query) {
    summaryParts.push(`Search: ${catalogFilters.query}`);
  }

  if (catalogFilters.enrichmentStatus.length > 0) {
    summaryParts.push(
      `Enrichment: ${formatStatusLabels(catalogFilters.enrichmentStatus, ENRICHMENT_FILTER_LABELS)}`,
    );
  }

  if (catalogFilters.advancedReportStatus.length > 0) {
    summaryParts.push(
      `Report: ${formatStatusLabels(
        catalogFilters.advancedReportStatus,
        ADVANCED_REPORT_FILTER_LABELS,
      )}`,
    );
  }

  return summaryParts.length > 0 ? summaryParts.join(" · ") : "All catalog channels";
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

export function parseCatalogUrlState(
  searchParams: Pick<URLSearchParams, "get" | "getAll">,
): CatalogUrlState {
  const page = isPositiveInteger(searchParams.get("page"))
    ? Number.parseInt(searchParams.get("page") as string, 10)
    : 1;

  return {
    page,
    filters: normalizeCatalogFilters({
      query: searchParams.get("query") ?? undefined,
      enrichmentStatus: searchParams.getAll("enrichmentStatus"),
      advancedReportStatus: searchParams.getAll("advancedReportStatus"),
    }),
  };
}

export function buildCatalogSearchParams(state: CatalogUrlState): URLSearchParams {
  const params = new URLSearchParams();

  params.set("page", String(state.page));

  if (state.filters.query) {
    params.set("query", state.filters.query);
  }

  for (const status of state.filters.enrichmentStatus) {
    params.append("enrichmentStatus", status);
  }

  for (const status of state.filters.advancedReportStatus) {
    params.append("advancedReportStatus", status);
  }

  return params;
}

export function buildCatalogHref(pathname: string, state: CatalogUrlState): string {
  const search = buildCatalogSearchParams(state).toString();

  return search ? `${pathname}?${search}` : pathname;
}

export function areCatalogFiltersEqual(
  left: CatalogFiltersState,
  right: CatalogFiltersState,
): boolean {
  return (
    left.query === right.query &&
    left.enrichmentStatus.join(",") === right.enrichmentStatus.join(",") &&
    left.advancedReportStatus.join(",") === right.advancedReportStatus.join(",")
  );
}

export function toggleCatalogStatusFilter<T extends string>(values: readonly T[], value: T): T[] {
  const selected = new Set(values);

  if (selected.has(value)) {
    selected.delete(value);
    return values.filter((item) => item !== value);
  }

  return [...values, value];
}

function hasActiveCatalogFilters(filters: CatalogFiltersState): boolean {
  return Boolean(
    filters.query || filters.enrichmentStatus.length > 0 || filters.advancedReportStatus.length > 0,
  );
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

export function CatalogTableShellView({
  draftFilters,
  requestState,
  savedSegments,
  savedSegmentsRequestState,
  savedSegmentName,
  savedSegmentOperationStatus,
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
  onApplyFilters,
  onResetFilters,
  onRetry,
  onPreviousPage,
  onNextPage,
}: CatalogTableShellViewProps) {
  const activeFilters = hasActiveCatalogFilters(draftFilters);
  const isSavingSegment = pendingSegmentAction === "create";
  const hasSavedSegments = savedSegments.length > 0;

  return (
    <div className="catalog-table">
      <section aria-labelledby="catalog-saved-segments-heading" className="catalog-table__segments">
        <div className="catalog-table__segments-header">
          <div>
            <h2 id="catalog-saved-segments-heading">Saved segments</h2>
            <p>Save your current catalog filters and reload them later without rebuilding the query.</p>
          </div>
        </div>

        <div className="catalog-table__segments-actions">
          <label className="catalog-table__search">
            <span>Segment name</span>
            <input
              name="segmentName"
              onChange={(event) => {
                onSavedSegmentNameChange(event.target.value);
              }}
              placeholder="Space creators"
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
            type="button"
          >
            {isSavingSegment ? "Saving..." : "Save current filters"}
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
      </section>

      <section aria-labelledby="catalog-filter-heading" className="catalog-table__filters">
        <div className="catalog-table__filters-header">
          <div>
            <h2 id="catalog-filter-heading">Filters</h2>
            <p>Search the shared catalog and narrow results by current enrichment or report status.</p>
          </div>
          {activeFilters ? <span className="catalog-table__filters-badge">Filters active</span> : null}
        </div>

        <div className="catalog-table__filters-grid">
          <label className="catalog-table__search">
            <span>Search</span>
            <input
              name="query"
              onChange={(event) => {
                onDraftQueryChange(event.target.value);
              }}
              placeholder="Search title, handle, or YouTube channel ID"
              type="search"
              value={draftFilters.query}
            />
          </label>

          <FilterCheckboxGroup
            legend="Enrichment status"
            onToggle={onToggleEnrichmentStatus}
            options={ENRICHMENT_FILTER_OPTIONS}
            selected={draftFilters.enrichmentStatus}
          />

          <FilterCheckboxGroup
            legend="Advanced report status"
            onToggle={onToggleAdvancedReportStatus}
            options={ADVANCED_REPORT_FILTER_OPTIONS}
            selected={draftFilters.advancedReportStatus}
          />
        </div>

        <div className="catalog-table__filter-actions">
          <button className="catalog-table__button" onClick={onApplyFilters} type="button">
            Apply filters
          </button>
          <button
            className="catalog-table__button catalog-table__button--secondary"
            disabled={!activeFilters && !hasPendingFilterChanges}
            onClick={onResetFilters}
            type="button"
          >
            Reset
          </button>
          {hasPendingFilterChanges ? (
            <p className="catalog-table__filter-note">Draft changes are ready to apply.</p>
          ) : null}
        </div>
      </section>

      {requestState.status === "loading" ? (
        <p className="catalog-table__feedback catalog-table__feedback--loading">Loading channels...</p>
      ) : null}

      {requestState.status === "error" ? (
        <div className="catalog-table__feedback catalog-table__feedback--error" role="alert">
          <p>{requestState.error}</p>
          <button className="catalog-table__button catalog-table__button--secondary" onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : null}

      {requestState.status === "ready" ? (
        <CatalogTableResults
          data={requestState.data}
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
        />
      ) : null}
    </div>
  );
}

function CatalogTableResults({
  data,
  onPreviousPage,
  onNextPage,
}: {
  data: ListChannelsResponse;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const hasChannels = data.items.length > 0;
  const hasPreviousPage = hasPreviousCatalogPage(data);
  const hasNextPage = hasNextCatalogPage(data);

  return (
    <>
      <div className="catalog-table__toolbar">
        <p className="catalog-table__summary">{formatChannelCountSummary(data)}</p>
        <div className="catalog-table__pagination">
          <button
            className="catalog-table__button catalog-table__button--secondary"
            disabled={!hasPreviousPage}
            onClick={onPreviousPage}
            type="button"
          >
            Previous
          </button>
          <span className="catalog-table__page-indicator">Page {data.page}</span>
          <button
            className="catalog-table__button catalog-table__button--secondary"
            disabled={!hasNextPage}
            onClick={onNextPage}
            type="button"
          >
            Next
          </button>
        </div>
      </div>

      {!hasChannels ? (
        <p className="catalog-table__feedback catalog-table__feedback--empty">
          {getEmptyCatalogMessage(data)}
        </p>
      ) : (
        <div className="catalog-table__table-wrap">
          <table className="catalog-table__table">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">YouTube channel ID</th>
                <th scope="col">Enrichment</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((channel) => (
                <tr key={channel.id}>
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
                        <p className="catalog-table__title">{channel.title}</p>
                        <p className="catalog-table__meta">{getChannelHandle(channel)}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <code className="catalog-table__code">{channel.youtubeChannelId}</code>
                  </td>
                  <td>
                    <span
                      className={`catalog-table__status catalog-table__status--${channel.enrichment.status}`}
                    >
                      {getEnrichmentLabel(channel)}
                    </span>
                  </td>
                  <td>
                    <Link className="catalog-table__link" href={`/catalog/${channel.id}`}>
                      Open channel
                    </Link>
                  </td>
                </tr>
              ))}
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

  useEffect(() => {
    setDraftFilters(appliedState.filters);
  }, [appliedStateKey]);

  useEffect(() => {
    const abortController = new AbortController();

    setRequestState({
      status: "loading",
      data: null,
      error: null,
    });

    void fetchChannels(
      {
        page: appliedState.page,
        pageSize,
        ...(appliedState.filters.query ? { query: appliedState.filters.query } : {}),
        ...(appliedState.filters.enrichmentStatus.length > 0
          ? { enrichmentStatus: appliedState.filters.enrichmentStatus }
          : {}),
        ...(appliedState.filters.advancedReportStatus.length > 0
          ? { advancedReportStatus: appliedState.filters.advancedReportStatus }
          : {}),
      },
      abortController.signal,
    )
      .then((data) => {
        if (abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "ready",
          data,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "error",
          data: null,
          error: error instanceof Error && error.message ? error.message : "Unable to load channels. Please try again.",
        });
      });

    return () => {
      abortController.abort();
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

  return (
    <CatalogTableShellView
      draftFilters={draftFilters}
      hasPendingFilterChanges={!areCatalogFiltersEqual(draftFilters, appliedState.filters)}
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
        setDraftFilters(DEFAULT_FILTERS);
        replaceCatalogState({
          page: 1,
          filters: DEFAULT_FILTERS,
        });
      }}
      onRetrySavedSegments={() => {
        setSavedSegmentsReloadToken((current) => current + 1);
      }}
      onRetry={() => {
        setReloadToken((current) => current + 1);
      }}
      onSavedSegmentNameChange={(value) => {
        setSavedSegmentName(value);
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
      pendingSegmentAction={pendingSegmentAction}
      requestState={requestState}
      savedSegmentName={savedSegmentName}
      savedSegmentOperationStatus={savedSegmentOperationStatus}
      savedSegments={savedSegments}
      savedSegmentsRequestState={savedSegmentsRequestState}
    />
  );
}
