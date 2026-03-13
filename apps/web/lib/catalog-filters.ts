import type {
  CatalogChannelFilters,
  ChannelAdvancedReportStatus,
  ChannelEnrichmentStatus,
  SegmentFilters,
} from "@scouting-platform/contracts";

export type CatalogFiltersState = {
  query: string;
  enrichmentStatus: ChannelEnrichmentStatus[];
  advancedReportStatus: ChannelAdvancedReportStatus[];
};

export type CatalogFilterInput = Pick<CatalogChannelFilters, "query"> & {
  enrichmentStatus?: readonly string[];
  advancedReportStatus?: readonly string[];
};

export type CatalogUrlState = {
  page: number;
  filters: CatalogFiltersState;
};

export type CatalogFilterOption<T extends string> = {
  value: T;
  label: string;
};

export const ENRICHMENT_FILTER_OPTIONS: ReadonlyArray<
  CatalogFilterOption<ChannelEnrichmentStatus>
> = [
  { value: "missing", label: "Missing" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Ready" },
  { value: "failed", label: "Failed" },
  { value: "stale", label: "Stale" },
];

export const ADVANCED_REPORT_FILTER_OPTIONS: ReadonlyArray<
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

export const DEFAULT_CATALOG_FILTERS: CatalogFiltersState = {
  query: "",
  enrichmentStatus: [],
  advancedReportStatus: [],
};

const ENRICHMENT_FILTER_LABELS = new Map(
  ENRICHMENT_FILTER_OPTIONS.map((option) => [option.value, option.label]),
);

const ADVANCED_REPORT_FILTER_LABELS = new Map(
  ADVANCED_REPORT_FILTER_OPTIONS.map((option) => [option.value, option.label]),
);

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

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function formatStatusLabels<T extends string>(
  values: readonly T[],
  labels: ReadonlyMap<T, string>,
): string {
  return values.map((value) => labels.get(value) ?? value).join(", ");
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

export function buildCatalogChannelFilters(filters: CatalogFiltersState): CatalogChannelFilters {
  const normalized = normalizeCatalogFilters(filters);
  const requestFilters: CatalogChannelFilters = {};

  if (normalized.query) {
    requestFilters.query = normalized.query;
  }

  if (normalized.enrichmentStatus.length > 0) {
    requestFilters.enrichmentStatus = [...normalized.enrichmentStatus];
  }

  if (normalized.advancedReportStatus.length > 0) {
    requestFilters.advancedReportStatus = [...normalized.advancedReportStatus];
  }

  return requestFilters;
}

export function buildSavedSegmentFilters(filters: CatalogFiltersState): SegmentFilters {
  const requestFilters = buildCatalogChannelFilters(filters);
  const savedFilters: SegmentFilters = {};

  if (requestFilters.query) {
    savedFilters.query = requestFilters.query;
  }

  if (requestFilters.enrichmentStatus) {
    savedFilters.enrichmentStatus = requestFilters.enrichmentStatus;
  }

  if (requestFilters.advancedReportStatus) {
    savedFilters.advancedReportStatus = requestFilters.advancedReportStatus;
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

export function parseCatalogFiltersFromSearchParams(
  searchParams: Pick<URLSearchParams, "get" | "getAll">,
): CatalogFiltersState {
  return normalizeCatalogFilters({
    query: searchParams.get("query") ?? undefined,
    enrichmentStatus: searchParams.getAll("enrichmentStatus"),
    advancedReportStatus: searchParams.getAll("advancedReportStatus"),
  });
}

export function buildCatalogFilterSearchParams(filters: CatalogFiltersState): URLSearchParams {
  const params = new URLSearchParams();
  const normalized = normalizeCatalogFilters(filters);

  if (normalized.query) {
    params.set("query", normalized.query);
  }

  for (const status of normalized.enrichmentStatus) {
    params.append("enrichmentStatus", status);
  }

  for (const status of normalized.advancedReportStatus) {
    params.append("advancedReportStatus", status);
  }

  return params;
}

export function buildCatalogFilterHref(pathname: string, filters: CatalogFiltersState): string {
  const search = buildCatalogFilterSearchParams(filters).toString();

  return search ? `${pathname}?${search}` : pathname;
}

export function parseCatalogUrlState(
  searchParams: Pick<URLSearchParams, "get" | "getAll">,
): CatalogUrlState {
  const page = isPositiveInteger(searchParams.get("page"))
    ? Number.parseInt(searchParams.get("page") as string, 10)
    : 1;

  return {
    page,
    filters: parseCatalogFiltersFromSearchParams(searchParams),
  };
}

export function buildCatalogSearchParams(state: CatalogUrlState): URLSearchParams {
  const params = new URLSearchParams();
  const filterParams = buildCatalogFilterSearchParams(state.filters);

  params.set("page", String(state.page));

  for (const [key, value] of filterParams.entries()) {
    params.append(key, value);
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

export function hasActiveCatalogFilters(filters: CatalogFiltersState): boolean {
  return Boolean(
    filters.query || filters.enrichmentStatus.length > 0 || filters.advancedReportStatus.length > 0,
  );
}
