import type {
  CatalogChannelFilters,
  SegmentFilters,
} from "@scouting-platform/contracts";

export type CatalogNumericFilterKey =
  | "youtubeVideoMedianViewsMin"
  | "youtubeVideoMedianViewsMax"
  | "youtubeShortsMedianViewsMin"
  | "youtubeShortsMedianViewsMax"
  | "youtubeFollowersMin"
  | "youtubeFollowersMax";

export type CatalogMultiValueFilterKey =
  | "countryRegion"
  | "influencerVertical"
  | "influencerType";

export type CatalogEnrichmentFilter = "enriched" | "not_enriched";

export type CatalogFiltersState = {
  query: string;
  countryRegion: string[];
  influencerVertical: string[];
  influencerType: string[];
  youtubeVideoMedianViewsMin: string;
  youtubeVideoMedianViewsMax: string;
  youtubeShortsMedianViewsMin: string;
  youtubeShortsMedianViewsMax: string;
  youtubeFollowersMin: string;
  youtubeFollowersMax: string;
  enrichmentStatus: CatalogEnrichmentFilter | "";
};

export type CatalogFilterInput = Pick<
  CatalogChannelFilters,
  "query" | "countryRegion" | "influencerVertical" | "influencerType"
> &
  Partial<Record<CatalogNumericFilterKey, unknown>> & {
    enrichmentStatus?: readonly string[];
    // Legacy advanced report status filter is intentionally accepted and ignored so old URLs
    // and saved segments do not crash the catalog after the filter model change.
    advancedReportStatus?: readonly string[];
  };

export type CatalogUrlState = {
  page: number;
  filters: CatalogFiltersState;
};

export type CatalogFilterOption<T extends string = string> = {
  value: T;
  label: string;
};

export type CatalogCreatorFilterOptions = {
  countryRegion: CatalogFilterOption[];
  influencerVertical: CatalogFilterOption[];
  influencerType: CatalogFilterOption[];
};

export const EMPTY_CATALOG_CREATOR_FILTER_OPTIONS: CatalogCreatorFilterOptions = {
  countryRegion: [],
  influencerVertical: [],
  influencerType: [],
};

const CATALOG_NUMERIC_FILTER_KEYS: readonly CatalogNumericFilterKey[] = [
  "youtubeVideoMedianViewsMin",
  "youtubeVideoMedianViewsMax",
  "youtubeShortsMedianViewsMin",
  "youtubeShortsMedianViewsMax",
  "youtubeFollowersMin",
  "youtubeFollowersMax",
];

export const DEFAULT_CATALOG_FILTERS: CatalogFiltersState = {
  query: "",
  countryRegion: [],
  influencerVertical: [],
  influencerType: [],
  youtubeVideoMedianViewsMin: "",
  youtubeVideoMedianViewsMax: "",
  youtubeShortsMedianViewsMin: "",
  youtubeShortsMedianViewsMax: "",
  youtubeFollowersMin: "",
  youtubeFollowersMax: "",
  enrichmentStatus: "",
};

const MULTI_VALUE_FILTER_LABELS: Record<CatalogMultiValueFilterKey, string> = {
  countryRegion: "Country/Region",
  influencerVertical: "Influencer Vertical",
  influencerType: "Influencer Type",
};

function isPositiveInteger(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizeStringArray(values: readonly string[] | undefined): string[] {
  if (!values) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();

    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export function normalizeCatalogNumericFilterValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const rawValue = typeof value === "number" ? String(value) : String(value).trim();

  if (!/^\d+$/.test(rawValue)) {
    return "";
  }

  const parsedValue = Number(rawValue);

  if (!Number.isSafeInteger(parsedValue) || parsedValue < 0) {
    return "";
  }

  return String(parsedValue);
}

function toOptionalNumber(value: string): number | undefined {
  return value ? Number(value) : undefined;
}

function normalizeEnrichmentFilter(value: unknown): CatalogEnrichmentFilter | "" {
  if (value === "enriched" || value === "not_enriched") {
    return value;
  }

  return "";
}

function formatFilterMetric(value: string): string {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue)) {
    return value;
  }

  return new Intl.NumberFormat("en-US").format(parsedValue);
}

function formatRangeSummary(
  min: string,
  max: string,
  label: string,
): string | null {
  if (min && max) {
    return `${label}: ${formatFilterMetric(min)}-${formatFilterMetric(max)}`;
  }

  if (min) {
    return `${label}: >= ${formatFilterMetric(min)}`;
  }

  if (max) {
    return `${label}: <= ${formatFilterMetric(max)}`;
  }

  return null;
}

export function normalizeCatalogFilters(filters: CatalogFilterInput): CatalogFiltersState {
  // Map raw enrichmentStatus array to simplified UI filter value.
  // "completed" → "enriched"; anything else in the set → "not_enriched".
  const rawEnrichmentStatus = filters.enrichmentStatus;
  let enrichmentStatus: CatalogEnrichmentFilter | "" = "";

  if (rawEnrichmentStatus && rawEnrichmentStatus.length > 0) {
    const hasCompleted = rawEnrichmentStatus.includes("completed");
    const hasMissing = rawEnrichmentStatus.includes("missing");
    const hasFailed = rawEnrichmentStatus.includes("failed");

    if (hasCompleted && !hasMissing && !hasFailed) {
      // ["completed"] (legacy) or ["completed", "stale"] (current) → enriched.
      enrichmentStatus = "enriched";
    } else if ((hasMissing || hasFailed) && !hasCompleted) {
      // ["missing", "failed"] (current) or ["missing", "failed", "stale"] (legacy) → not_enriched.
      enrichmentStatus = "not_enriched";
    } else {
      // Simplified values passed directly from URL params ("enriched" / "not_enriched").
      enrichmentStatus = normalizeEnrichmentFilter(rawEnrichmentStatus[0]);
    }
  }

  return {
    query: filters.query?.trim() ?? "",
    countryRegion: normalizeStringArray(filters.countryRegion),
    influencerVertical: normalizeStringArray(filters.influencerVertical),
    influencerType: normalizeStringArray(filters.influencerType),
    youtubeVideoMedianViewsMin: normalizeCatalogNumericFilterValue(
      filters.youtubeVideoMedianViewsMin,
    ),
    youtubeVideoMedianViewsMax: normalizeCatalogNumericFilterValue(
      filters.youtubeVideoMedianViewsMax,
    ),
    youtubeShortsMedianViewsMin: normalizeCatalogNumericFilterValue(
      filters.youtubeShortsMedianViewsMin,
    ),
    youtubeShortsMedianViewsMax: normalizeCatalogNumericFilterValue(
      filters.youtubeShortsMedianViewsMax,
    ),
    youtubeFollowersMin: normalizeCatalogNumericFilterValue(filters.youtubeFollowersMin),
    youtubeFollowersMax: normalizeCatalogNumericFilterValue(filters.youtubeFollowersMax),
    enrichmentStatus,
  };
}

export function buildCatalogChannelFilters(filters: CatalogFiltersState): CatalogChannelFilters {
  // CatalogFiltersState is already normalized, but trim query defensively for safety.
  const requestFilters: CatalogChannelFilters = {};
  const trimmedQuery = filters.query.trim();

  if (trimmedQuery) {
    requestFilters.query = trimmedQuery;
  }

  if (filters.countryRegion.length > 0) {
    requestFilters.countryRegion = [...filters.countryRegion];
  }

  if (filters.influencerVertical.length > 0) {
    requestFilters.influencerVertical = [...filters.influencerVertical];
  }

  if (filters.influencerType.length > 0) {
    requestFilters.influencerType = [...filters.influencerType];
  }

  for (const key of CATALOG_NUMERIC_FILTER_KEYS) {
    const value = toOptionalNumber(filters[key]);

    if (value !== undefined) {
      (requestFilters as Partial<Record<CatalogNumericFilterKey, number>>)[key] = value;
    }
  }

  if (filters.enrichmentStatus === "enriched") {
    // "Enriched" means the channel has enrichment data — completed or stale (data exists but is old).
    requestFilters.enrichmentStatus = ["completed", "stale"];
  } else if (filters.enrichmentStatus === "not_enriched") {
    // "Not enriched" means the channel has no enrichment data at all.
    // Stale channels still have data so they are excluded; queued/running are in-progress.
    requestFilters.enrichmentStatus = ["missing", "failed"];
  }

  return requestFilters;
}

export function buildSavedSegmentFilters(filters: CatalogFiltersState): SegmentFilters {
  const requestFilters = buildCatalogChannelFilters(filters);
  const savedFilters: SegmentFilters = {};

  for (const [key, value] of Object.entries(requestFilters)) {
    savedFilters[key] = value;
  }

  return savedFilters;
}

export function getCatalogFiltersFromSavedSegment(filters: SegmentFilters): CatalogFiltersState {
  const rawEnrichmentStatus = filters.enrichmentStatus;
  const enrichmentStatusArray = Array.isArray(rawEnrichmentStatus)
    ? (rawEnrichmentStatus as string[])
    : typeof rawEnrichmentStatus === "string"
      ? [rawEnrichmentStatus]
      : [];

  return normalizeCatalogFilters({
    query: typeof filters.query === "string" ? filters.query : undefined,
    countryRegion: getStringArray(filters.countryRegion),
    influencerVertical: getStringArray(filters.influencerVertical),
    influencerType: getStringArray(filters.influencerType),
    youtubeVideoMedianViewsMin: filters.youtubeVideoMedianViewsMin,
    youtubeVideoMedianViewsMax: filters.youtubeVideoMedianViewsMax,
    youtubeShortsMedianViewsMin: filters.youtubeShortsMedianViewsMin,
    youtubeShortsMedianViewsMax: filters.youtubeShortsMedianViewsMax,
    youtubeFollowersMin: filters.youtubeFollowersMin,
    youtubeFollowersMax: filters.youtubeFollowersMax,
    enrichmentStatus: enrichmentStatusArray,
  });
}

export function formatSavedSegmentSummary(filters: SegmentFilters): string {
  const catalogFilters = getCatalogFiltersFromSavedSegment(filters);
  const summaryParts: string[] = [];

  if (catalogFilters.query) {
    summaryParts.push(`Search: ${catalogFilters.query}`);
  }

  for (const key of ["countryRegion", "influencerVertical", "influencerType"] as const) {
    if (catalogFilters[key].length > 0) {
      summaryParts.push(`${MULTI_VALUE_FILTER_LABELS[key]}: ${catalogFilters[key].join(", ")}`);
    }
  }

  const videoMedianSummary = formatRangeSummary(
    catalogFilters.youtubeVideoMedianViewsMin,
    catalogFilters.youtubeVideoMedianViewsMax,
    "Video median",
  );
  const shortsMedianSummary = formatRangeSummary(
    catalogFilters.youtubeShortsMedianViewsMin,
    catalogFilters.youtubeShortsMedianViewsMax,
    "Shorts median",
  );
  const followersSummary = formatRangeSummary(
    catalogFilters.youtubeFollowersMin,
    catalogFilters.youtubeFollowersMax,
    "Followers",
  );

  if (videoMedianSummary) {
    summaryParts.push(videoMedianSummary);
  }

  if (shortsMedianSummary) {
    summaryParts.push(shortsMedianSummary);
  }

  if (followersSummary) {
    summaryParts.push(followersSummary);
  }

  return summaryParts.length > 0 ? summaryParts.join(" · ") : "All catalog channels";
}

export function parseCatalogFiltersFromSearchParams(
  searchParams: Pick<URLSearchParams, "get" | "getAll">,
): CatalogFiltersState {
  const rawEnrichmentStatus = searchParams.get("enrichmentStatus");
  const enrichmentStatusArray = rawEnrichmentStatus ? [rawEnrichmentStatus] : [];

  return normalizeCatalogFilters({
    query: searchParams.get("query") ?? undefined,
    countryRegion: searchParams.getAll("countryRegion"),
    influencerVertical: searchParams.getAll("influencerVertical"),
    influencerType: searchParams.getAll("influencerType"),
    youtubeVideoMedianViewsMin: searchParams.get("youtubeVideoMedianViewsMin"),
    youtubeVideoMedianViewsMax: searchParams.get("youtubeVideoMedianViewsMax"),
    youtubeShortsMedianViewsMin: searchParams.get("youtubeShortsMedianViewsMin"),
    youtubeShortsMedianViewsMax: searchParams.get("youtubeShortsMedianViewsMax"),
    youtubeFollowersMin: searchParams.get("youtubeFollowersMin"),
    youtubeFollowersMax: searchParams.get("youtubeFollowersMax"),
    enrichmentStatus: enrichmentStatusArray,
  });
}

export function buildCatalogFilterSearchParams(filters: CatalogFiltersState): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.query) {
    params.set("query", filters.query);
  }

  for (const value of filters.countryRegion) {
    params.append("countryRegion", value);
  }

  for (const value of filters.influencerVertical) {
    params.append("influencerVertical", value);
  }

  for (const value of filters.influencerType) {
    params.append("influencerType", value);
  }

  for (const key of CATALOG_NUMERIC_FILTER_KEYS) {
    if (filters[key]) {
      params.set(key, filters[key]);
    }
  }

  if (filters.enrichmentStatus) {
    params.set("enrichmentStatus", filters.enrichmentStatus);
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
    left.countryRegion.join(",") === right.countryRegion.join(",") &&
    left.influencerVertical.join(",") === right.influencerVertical.join(",") &&
    left.influencerType.join(",") === right.influencerType.join(",") &&
    CATALOG_NUMERIC_FILTER_KEYS.every((key) => left[key] === right[key]) &&
    left.enrichmentStatus === right.enrichmentStatus
  );
}

export function toggleCatalogMultiValueFilter(
  values: readonly string[],
  value: string,
): string[] {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return [...values];
  }

  if (values.includes(trimmedValue)) {
    return values.filter((item) => item !== trimmedValue);
  }

  return [...values, trimmedValue];
}

export function hasActiveCatalogFilters(filters: CatalogFiltersState): boolean {
  return Boolean(
    filters.query ||
      filters.countryRegion.length > 0 ||
      filters.influencerVertical.length > 0 ||
      filters.influencerType.length > 0 ||
      CATALOG_NUMERIC_FILTER_KEYS.some((key) => filters[key]) ||
      filters.enrichmentStatus,
  );
}

export function countActiveCatalogFilters(filters: CatalogFiltersState): number {
  return (
    (filters.query.trim() ? 1 : 0) +
    filters.countryRegion.length +
    filters.influencerVertical.length +
    filters.influencerType.length +
    CATALOG_NUMERIC_FILTER_KEYS.filter((key) => Boolean(filters[key])).length +
    (filters.enrichmentStatus ? 1 : 0)
  );
}
