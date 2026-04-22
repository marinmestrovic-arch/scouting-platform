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
};

export type CatalogFilterInput = Pick<
  CatalogChannelFilters,
  "query" | "countryRegion" | "influencerVertical" | "influencerType"
> &
  Partial<Record<CatalogNumericFilterKey, unknown>> & {
    // Legacy status filters are intentionally accepted and ignored so old URLs and
    // saved segments do not crash the catalog after the filter model change.
    enrichmentStatus?: readonly string[];
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

export const CATALOG_NUMERIC_FILTER_KEYS: readonly CatalogNumericFilterKey[] = [
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
};

const MULTI_VALUE_FILTER_LABELS: Record<CatalogMultiValueFilterKey, string> = {
  countryRegion: "Country/Region",
  influencerVertical: "Influencer Vertical",
  influencerType: "Influencer Type",
};

const NUMERIC_FILTER_LABELS: Record<CatalogNumericFilterKey, string> = {
  youtubeVideoMedianViewsMin: "Video median min",
  youtubeVideoMedianViewsMax: "Video median max",
  youtubeShortsMedianViewsMin: "Shorts median min",
  youtubeShortsMedianViewsMax: "Shorts median max",
  youtubeFollowersMin: "Followers min",
  youtubeFollowersMax: "Followers max",
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
  };
}

export function buildCatalogChannelFilters(filters: CatalogFiltersState): CatalogChannelFilters {
  const normalized = normalizeCatalogFilters(filters);
  const requestFilters: CatalogChannelFilters = {};

  if (normalized.query) {
    requestFilters.query = normalized.query;
  }

  if (normalized.countryRegion.length > 0) {
    requestFilters.countryRegion = [...normalized.countryRegion];
  }

  if (normalized.influencerVertical.length > 0) {
    requestFilters.influencerVertical = [...normalized.influencerVertical];
  }

  if (normalized.influencerType.length > 0) {
    requestFilters.influencerType = [...normalized.influencerType];
  }

  for (const key of CATALOG_NUMERIC_FILTER_KEYS) {
    const value = toOptionalNumber(normalized[key]);

    if (value !== undefined) {
      (requestFilters as Partial<Record<CatalogNumericFilterKey, number>>)[key] = value;
    }
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
  });
}

export function buildCatalogFilterSearchParams(filters: CatalogFiltersState): URLSearchParams {
  const params = new URLSearchParams();
  const normalized = normalizeCatalogFilters(filters);

  if (normalized.query) {
    params.set("query", normalized.query);
  }

  for (const value of normalized.countryRegion) {
    params.append("countryRegion", value);
  }

  for (const value of normalized.influencerVertical) {
    params.append("influencerVertical", value);
  }

  for (const value of normalized.influencerType) {
    params.append("influencerType", value);
  }

  for (const key of CATALOG_NUMERIC_FILTER_KEYS) {
    if (normalized[key]) {
      params.set(key, normalized[key]);
    }
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
    CATALOG_NUMERIC_FILTER_KEYS.every((key) => left[key] === right[key])
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
      CATALOG_NUMERIC_FILTER_KEYS.some((key) => filters[key]),
  );
}

export function countActiveCatalogFilters(filters: CatalogFiltersState): number {
  return (
    (filters.query.trim() ? 1 : 0) +
    filters.countryRegion.length +
    filters.influencerVertical.length +
    filters.influencerType.length +
    CATALOG_NUMERIC_FILTER_KEYS.filter((key) => Boolean(filters[key])).length
  );
}

export function getCatalogNumericFilterLabel(key: CatalogNumericFilterKey): string {
  return NUMERIC_FILTER_LABELS[key];
}
