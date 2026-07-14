export const CATALOG_SCOUTING_QUERY_PREFIX = "Catalog scouting criteria";

export const CATALOG_SCOUTING_FIELDS = [
  { key: "subscribers", label: "Subscribers" },
  { key: "views", label: "Views" },
  { key: "location", label: "Location" },
  { key: "language", label: "Language" },
  { key: "lastPostDaysSince", label: "Last post days since" },
  { key: "category", label: "Category" },
  { key: "niche", label: "Niche" },
] as const;

export type CatalogScoutingCriteriaField = (typeof CATALOG_SCOUTING_FIELDS)[number]["key"];

export type CatalogScoutingCriteria = Record<CatalogScoutingCriteriaField, string>;

export const EMPTY_CATALOG_SCOUTING_CRITERIA: CatalogScoutingCriteria = {
  subscribers: "",
  views: "",
  location: "",
  language: "",
  lastPostDaysSince: "",
  category: "",
  niche: "",
};

const CATALOG_SCOUTING_ESCAPE_CHARACTER = "\\";

const CATALOG_SCOUTING_LABEL_TO_FIELD = new Map(
  CATALOG_SCOUTING_FIELDS.map((field) => [field.label.toLowerCase(), field.key]),
);

function escapeCatalogScoutingValue(value: string): string {
  return value
    .replaceAll(CATALOG_SCOUTING_ESCAPE_CHARACTER, `${CATALOG_SCOUTING_ESCAPE_CHARACTER}${CATALOG_SCOUTING_ESCAPE_CHARACTER}`)
    .replaceAll("|", `${CATALOG_SCOUTING_ESCAPE_CHARACTER}|`);
}

function unescapeCatalogScoutingValue(value: string): string | null {
  let parsed = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character !== CATALOG_SCOUTING_ESCAPE_CHARACTER) {
      parsed += character;
      continue;
    }

    const escapedCharacter = value[index + 1];

    if (
      escapedCharacter !== CATALOG_SCOUTING_ESCAPE_CHARACTER &&
      escapedCharacter !== "|"
    ) {
      return null;
    }

    parsed += escapedCharacter;
    index += 1;
  }

  return parsed;
}

function splitCatalogScoutingSegments(query: string): string[] | null {
  const segments: string[] = [];
  let currentSegment = "";
  let isEscaped = false;

  for (const character of query) {
    if (isEscaped) {
      currentSegment += character;
      isEscaped = false;
      continue;
    }

    if (character === CATALOG_SCOUTING_ESCAPE_CHARACTER) {
      currentSegment += character;
      isEscaped = true;
      continue;
    }

    if (character === "|") {
      segments.push(currentSegment.trim());
      currentSegment = "";
      continue;
    }

    currentSegment += character;
  }

  if (isEscaped) {
    return null;
  }

  segments.push(currentSegment.trim());
  return segments.filter((segment) => segment.length > 0);
}

function parseCatalogScoutingQuerySegments(
  query: string,
): CatalogScoutingCriteria | null {
  const segments = splitCatalogScoutingSegments(query.trim());

  if (!segments || segments[0] !== CATALOG_SCOUTING_QUERY_PREFIX) {
    return null;
  }

  const criteriaSegments = segments.slice(1);

  if (criteriaSegments.length !== CATALOG_SCOUTING_FIELDS.length) {
    return null;
  }

  const parsed = { ...EMPTY_CATALOG_SCOUTING_CRITERIA };
  const parsedFields = new Set<CatalogScoutingCriteriaField>();

  for (const segment of criteriaSegments) {
    const separatorIndex = segment.indexOf(":");

    if (separatorIndex < 0) {
      return null;
    }

    const label = segment.slice(0, separatorIndex).trim().toLowerCase();
    const rawValue = segment.slice(separatorIndex + 1).trim();
    const field = CATALOG_SCOUTING_LABEL_TO_FIELD.get(label);

    if (!field || parsedFields.has(field)) {
      return null;
    }

    const value = unescapeCatalogScoutingValue(rawValue);

    if (value === null) {
      return null;
    }

    parsed[field] = value === "Any" ? "" : value;
    parsedFields.add(field);
  }

  return parsedFields.size === CATALOG_SCOUTING_FIELDS.length ? parsed : null;
}

export function normalizeCatalogScoutingCriteria(
  criteria: Partial<CatalogScoutingCriteria>,
): CatalogScoutingCriteria {
  return {
    subscribers: criteria.subscribers?.trim() ?? "",
    views: criteria.views?.trim() ?? "",
    location: criteria.location?.trim() ?? "",
    language: criteria.language?.trim() ?? "",
    lastPostDaysSince: criteria.lastPostDaysSince?.trim() ?? "",
    category: criteria.category?.trim() ?? "",
    niche: criteria.niche?.trim() ?? "",
  };
}

export function hasCatalogScoutingCriteria(
  criteria: Partial<CatalogScoutingCriteria>,
): boolean {
  const normalized = normalizeCatalogScoutingCriteria(criteria);
  const searchableCriteria = [
    normalized.subscribers,
    normalized.views,
    normalized.location,
    normalized.language,
    normalized.lastPostDaysSince,
    normalized.category,
    normalized.niche,
  ];

  return searchableCriteria.some((value) => value.length > 0);
}

export function buildCatalogScoutingQuery(
  criteria: Partial<CatalogScoutingCriteria>,
): string {
  const normalized = normalizeCatalogScoutingCriteria(criteria);
  const segments = CATALOG_SCOUTING_FIELDS.map((field) => {
    const value = normalized[field.key]
      ? escapeCatalogScoutingValue(normalized[field.key])
      : "Any";
    return `${field.label}: ${value}`;
  });

  return [CATALOG_SCOUTING_QUERY_PREFIX, ...segments].join(" | ");
}

export function isCatalogScoutingQuery(query: string): boolean {
  return parseCatalogScoutingQuerySegments(query) !== null;
}

export function parseCatalogScoutingQuery(
  query: string,
): CatalogScoutingCriteria | null {
  return parseCatalogScoutingQuerySegments(query);
}
