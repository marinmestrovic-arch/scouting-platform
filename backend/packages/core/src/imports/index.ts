import {
  CsvImportBatchStatus as PrismaCsvImportBatchStatus,
  CsvImportRowStatus as PrismaCsvImportRowStatus,
  type Prisma,
} from "@prisma/client";
import {
  CREATOR_LIST_HUBSPOT_IMPORT_HEADER_BY_NORMALIZED,
  CREATOR_LIST_LEGACY_YOUTUBE_AVERAGE_VIEWS_HEADER,
  CREATOR_LIST_LEGACY_YOUTUBE_AVERAGE_VIEWS_HEADER_NORMALIZED,
  CSV_IMPORT_HEADER,
  CSV_IMPORT_FILE_SIZE_LIMIT_BYTES,
  CSV_IMPORT_LEGACY_V3_HEADER,
  CSV_IMPORT_LEGACY_V2_HEADER,
  CSV_IMPORT_MAX_DATA_ROWS,
  CSV_IMPORT_TEMPLATE_VERSION,
  normalizeCreatorListHubspotHeader,
  type CsvImportBatchDetail,
  type CsvImportBatchStatus,
  type CsvImportBatchSummary,
  type CsvImportRow,
  type CsvImportRowStatus,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import { resolveYoutubeChannelForEnrichment } from "@scouting-platform/integrations";
import { parse } from "csv-parse/sync";

import { getUserYoutubeApiKey } from "../auth/credentials";
import { ServiceError } from "../errors";
import { listDropdownOptions } from "../dropdown-values";
import { enqueueCsvImportJob } from "./queue";
export { stopCsvImportsQueue } from "./queue";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CSV_IMPORT_PROFILE_DROPDOWN_FIELD_KEYS = [
  "influencerType",
  "influencerVertical",
  "countryRegion",
  "language",
] as const;
const CSV_IMPORT_LEGACY_TEMPLATE_VERSION = "v2" as const;
const CSV_IMPORT_LEGACY_FIELD_LABELS = {
  youtubeChannelId: "YouTube Channel ID",
  channelTitle: "Channel Name",
  contactEmail: "Email",
  firstName: "First Name",
  lastName: "Last Name",
  subscriberCount: "YouTube Followers",
  viewCount: "View Count",
  videoCount: "Video Count",
  notes: "Notes",
  sourceLabel: "Source Label",
  influencerType: "Influencer Type",
  influencerVertical: "Influencer Vertical",
  countryRegion: "Country/Region",
  language: "Language",
} as const;
type CsvImportTemplateVersion = typeof CSV_IMPORT_TEMPLATE_VERSION | typeof CSV_IMPORT_LEGACY_TEMPLATE_VERSION;
type ParsedCsvHeaderTemplate = {
  templateVersion: CsvImportTemplateVersion;
  indexByHeader: Map<string, number>;
};
const csvImportBatchActorSelect = {
  id: true,
  email: true,
  name: true,
} as const;

const csvImportBatchSummarySelect = {
  id: true,
  fileName: true,
  templateVersion: true,
  status: true,
  totalRowCount: true,
  importedRowCount: true,
  failedRowCount: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
  requestedByUser: {
    select: csvImportBatchActorSelect,
  },
} as const;

const csvImportRowSelect = {
  id: true,
  rowNumber: true,
  status: true,
  youtubeChannelId: true,
  channelTitle: true,
  hubspotRecordId: true,
  timestampImported: true,
  channelUrl: true,
  campaignName: true,
  dealOwner: true,
  handoffStatus: true,
  contactEmail: true,
  phoneNumber: true,
  currency: true,
  dealType: true,
  contactType: true,
  month: true,
  year: true,
  clientName: true,
  dealName: true,
  activationName: true,
  pipeline: true,
  dealStage: true,
  firstName: true,
  lastName: true,
  youtubeHandle: true,
  youtubeUrl: true,
  subscriberCount: true,
  viewCount: true,
  videoCount: true,
  youtubeVideoMedianViews: true,
  youtubeShortsMedianViews: true,
  youtubeEngagementRate: true,
  youtubeFollowers: true,
  instagramHandle: true,
  instagramUrl: true,
  instagramPostAverageViews: true,
  instagramReelAverageViews: true,
  instagramStory7DayAverageViews: true,
  instagramStory30DayAverageViews: true,
  instagramEngagementRate: true,
  instagramFollowers: true,
  tiktokHandle: true,
  tiktokUrl: true,
  tiktokAverageViews: true,
  tiktokEngagementRate: true,
  tiktokFollowers: true,
  twitchHandle: true,
  twitchUrl: true,
  twitchAverageViews: true,
  twitchEngagementRate: true,
  twitchFollowers: true,
  kickHandle: true,
  kickUrl: true,
  kickAverageViews: true,
  kickEngagementRate: true,
  kickFollowers: true,
  xHandle: true,
  xUrl: true,
  xAverageViews: true,
  xEngagementRate: true,
  xFollowers: true,
  notes: true,
  sourceLabel: true,
  influencerType: true,
  influencerVertical: true,
  countryRegion: true,
  language: true,
  channelId: true,
  errorMessage: true,
} as const;

type CsvImportBatchSummaryRecord = Prisma.CsvImportBatchGetPayload<{
  select: typeof csvImportBatchSummarySelect;
}>;

type CsvImportRowRecord = Prisma.CsvImportRowGetPayload<{
  select: typeof csvImportRowSelect;
}>;

type CsvImportBatchDetailRecord = CsvImportBatchSummaryRecord & {
  rows: CsvImportRowRecord[];
};

type ParsedCsvImportRow = {
  rowNumber: number;
  status: PrismaCsvImportRowStatus;
  youtubeChannelId: string;
  channelTitle: string;
  hubspotRecordId: string | null;
  timestampImported: string | null;
  channelUrl: string | null;
  campaignName: string | null;
  dealOwner: string | null;
  handoffStatus: string | null;
  contactEmail: string | null;
  phoneNumber: string | null;
  currency: string | null;
  dealType: string | null;
  contactType: string | null;
  month: string | null;
  year: string | null;
  clientName: string | null;
  dealName: string | null;
  activationName: string | null;
  pipeline: string | null;
  dealStage: string | null;
  firstName: string | null;
  lastName: string | null;
  youtubeHandle: string | null;
  youtubeUrl: string | null;
  subscriberCount: string | null;
  viewCount: string | null;
  videoCount: string | null;
  youtubeVideoMedianViews: string | null;
  youtubeShortsMedianViews: string | null;
  youtubeEngagementRate: string | null;
  youtubeFollowers: string | null;
  instagramHandle: string | null;
  instagramUrl: string | null;
  instagramPostAverageViews: string | null;
  instagramReelAverageViews: string | null;
  instagramStory7DayAverageViews: string | null;
  instagramStory30DayAverageViews: string | null;
  instagramEngagementRate: string | null;
  instagramFollowers: string | null;
  tiktokHandle: string | null;
  tiktokUrl: string | null;
  tiktokAverageViews: string | null;
  tiktokEngagementRate: string | null;
  tiktokFollowers: string | null;
  twitchHandle: string | null;
  twitchUrl: string | null;
  twitchAverageViews: string | null;
  twitchEngagementRate: string | null;
  twitchFollowers: string | null;
  kickHandle: string | null;
  kickUrl: string | null;
  kickAverageViews: string | null;
  kickEngagementRate: string | null;
  kickFollowers: string | null;
  xHandle: string | null;
  xUrl: string | null;
  xAverageViews: string | null;
  xEngagementRate: string | null;
  xFollowers: string | null;
  notes: string | null;
  sourceLabel: string | null;
  influencerType: string | null;
  influencerVertical: string | null;
  countryRegion: string | null;
  language: string | null;
  errorMessage: string | null;
};

type BuildParsedRowsResult = {
  templateVersion: CsvImportTemplateVersion;
  rows: ParsedCsvImportRow[];
};

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toNullableTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toCsvImportBatchStatus(status: PrismaCsvImportBatchStatus): CsvImportBatchStatus {
  switch (status) {
    case PrismaCsvImportBatchStatus.RUNNING:
      return "running";
    case PrismaCsvImportBatchStatus.COMPLETED:
      return "completed";
    case PrismaCsvImportBatchStatus.FAILED:
      return "failed";
    default:
      return "queued";
  }
}

function toCsvImportRowStatus(status: PrismaCsvImportRowStatus): CsvImportRowStatus {
  switch (status) {
    case PrismaCsvImportRowStatus.IMPORTED:
      return "imported";
    case PrismaCsvImportRowStatus.FAILED:
      return "failed";
    default:
      return "pending";
  }
}

function toCsvImportRow(row: CsvImportBatchDetailRecord["rows"][number]): CsvImportRow {
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    status: toCsvImportRowStatus(row.status),
    youtubeChannelId: row.youtubeChannelId,
    channelTitle: row.channelTitle,
    hubspotRecordId: row.hubspotRecordId,
    timestampImported: row.timestampImported,
    channelUrl: row.channelUrl,
    campaignName: row.campaignName,
    dealOwner: row.dealOwner,
    handoffStatus: row.handoffStatus,
    contactEmail: row.contactEmail,
    phoneNumber: row.phoneNumber,
    currency: row.currency,
    dealType: row.dealType,
    contactType: row.contactType,
    month: row.month,
    year: row.year,
    clientName: row.clientName,
    dealName: row.dealName,
    activationName: row.activationName,
    pipeline: row.pipeline,
    dealStage: row.dealStage,
    firstName: row.firstName,
    lastName: row.lastName,
    youtubeHandle: row.youtubeHandle,
    youtubeUrl: row.youtubeUrl,
    subscriberCount: row.subscriberCount,
    viewCount: row.viewCount,
    videoCount: row.videoCount,
    youtubeVideoMedianViews: row.youtubeVideoMedianViews,
    youtubeShortsMedianViews: row.youtubeShortsMedianViews,
    youtubeEngagementRate: row.youtubeEngagementRate,
    youtubeFollowers: row.youtubeFollowers,
    instagramHandle: row.instagramHandle,
    instagramUrl: row.instagramUrl,
    instagramPostAverageViews: row.instagramPostAverageViews,
    instagramReelAverageViews: row.instagramReelAverageViews,
    instagramStory7DayAverageViews: row.instagramStory7DayAverageViews,
    instagramStory30DayAverageViews: row.instagramStory30DayAverageViews,
    instagramEngagementRate: row.instagramEngagementRate,
    instagramFollowers: row.instagramFollowers,
    tiktokHandle: row.tiktokHandle,
    tiktokUrl: row.tiktokUrl,
    tiktokAverageViews: row.tiktokAverageViews,
    tiktokEngagementRate: row.tiktokEngagementRate,
    tiktokFollowers: row.tiktokFollowers,
    twitchHandle: row.twitchHandle,
    twitchUrl: row.twitchUrl,
    twitchAverageViews: row.twitchAverageViews,
    twitchEngagementRate: row.twitchEngagementRate,
    twitchFollowers: row.twitchFollowers,
    kickHandle: row.kickHandle,
    kickUrl: row.kickUrl,
    kickAverageViews: row.kickAverageViews,
    kickEngagementRate: row.kickEngagementRate,
    kickFollowers: row.kickFollowers,
    xHandle: row.xHandle,
    xUrl: row.xUrl,
    xAverageViews: row.xAverageViews,
    xEngagementRate: row.xEngagementRate,
    xFollowers: row.xFollowers,
    notes: row.notes,
    sourceLabel: row.sourceLabel,
    influencerType: row.influencerType,
    influencerVertical: row.influencerVertical,
    countryRegion: row.countryRegion,
    language: row.language,
    channelId: row.channelId,
    errorMessage: row.errorMessage,
  };
}

function toCsvImportBatchSummary(batch: CsvImportBatchSummaryRecord): CsvImportBatchSummary {
  return {
    id: batch.id,
    fileName: batch.fileName,
    templateVersion: batch.templateVersion,
    status: toCsvImportBatchStatus(batch.status),
    totalRowCount: batch.totalRowCount,
    importedRowCount: batch.importedRowCount,
    failedRowCount: batch.failedRowCount,
    lastError: batch.lastError,
    requestedBy: {
      id: batch.requestedByUser.id,
      email: batch.requestedByUser.email,
      name: batch.requestedByUser.name,
    },
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    startedAt: batch.startedAt?.toISOString() ?? null,
    completedAt: batch.completedAt?.toISOString() ?? null,
  };
}

function toCsvImportBatchDetail(
  batch: CsvImportBatchDetailRecord,
  page: number,
  pageSize: number,
): CsvImportBatchDetail {
  return {
    ...toCsvImportBatchSummary(batch),
    page,
    pageSize,
    rows: batch.rows.map(toCsvImportRow),
  };
}

function parseCsvRows(csvText: string): string[][] {
  try {
    return parse(csvText, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
    }) as string[][];
  } catch {
    throw new ServiceError("CSV_IMPORT_UNREADABLE", 400, "Unreadable CSV file");
  }
}

const CSV_IMPORT_HEADER_NORMALIZED = CSV_IMPORT_HEADER.map(normalizeCreatorListHubspotHeader);
const CSV_IMPORT_LEGACY_V3_HEADER_NORMALIZED = CSV_IMPORT_LEGACY_V3_HEADER.map(
  normalizeCreatorListHubspotHeader,
);
const CSV_IMPORT_LEGACY_V2_HEADER_NORMALIZED = CSV_IMPORT_LEGACY_V2_HEADER.map(
  normalizeCreatorListHubspotHeader,
);
const CSV_IMPORT_V3_LABEL_BY_HEADER = CREATOR_LIST_HUBSPOT_IMPORT_HEADER_BY_NORMALIZED;
const CSV_IMPORT_V2_LABEL_BY_HEADER = new Map(
  CSV_IMPORT_LEGACY_V2_HEADER.map((header) => [
    normalizeCreatorListHubspotHeader(header),
    CSV_IMPORT_LEGACY_FIELD_LABELS[header],
  ]),
);

function toHeaderIndexMap(headerRow: string[]): Map<string, number> {
  const indexByHeader = new Map<string, number>();

  headerRow.forEach((header, index) => {
    indexByHeader.set(normalizeCreatorListHubspotHeader(header), index);
  });

  return indexByHeader;
}

function hasExactHeaderMatch(actualNormalizedHeader: string[], expectedNormalizedHeader: readonly string[]): boolean {
  return (
    actualNormalizedHeader.length === expectedNormalizedHeader.length
    && actualNormalizedHeader.every((value, index) => value === expectedNormalizedHeader[index])
  );
}

function parseHeaderTemplate(headerRow: string[] | undefined): ParsedCsvHeaderTemplate {
  if (!headerRow) {
    throw new ServiceError(
      "CSV_IMPORT_HEADER_INVALID",
      400,
      "CSV header does not match the supported v3 template or legacy compatibility templates",
    );
  }

  const normalizedHeader = headerRow.map(normalizeCreatorListHubspotHeader);

  if (normalizedHeader.includes(CREATOR_LIST_LEGACY_YOUTUBE_AVERAGE_VIEWS_HEADER_NORMALIZED)) {
    throw new ServiceError(
      "CSV_IMPORT_HEADER_INVALID",
      400,
      `${CREATOR_LIST_LEGACY_YOUTUBE_AVERAGE_VIEWS_HEADER} is no longer supported. Use YouTube Video Median Views.`,
    );
  }

  if (hasExactHeaderMatch(normalizedHeader, CSV_IMPORT_HEADER_NORMALIZED)) {
    return {
      templateVersion: CSV_IMPORT_TEMPLATE_VERSION,
      indexByHeader: toHeaderIndexMap(headerRow),
    };
  }

  if (hasExactHeaderMatch(normalizedHeader, CSV_IMPORT_LEGACY_V3_HEADER_NORMALIZED)) {
    return {
      templateVersion: CSV_IMPORT_TEMPLATE_VERSION,
      indexByHeader: toHeaderIndexMap(headerRow),
    };
  }

  if (hasExactHeaderMatch(normalizedHeader, CSV_IMPORT_LEGACY_V2_HEADER_NORMALIZED)) {
    return {
      templateVersion: CSV_IMPORT_LEGACY_TEMPLATE_VERSION,
      indexByHeader: toHeaderIndexMap(headerRow),
    };
  }

  throw new ServiceError(
    "CSV_IMPORT_HEADER_INVALID",
    400,
    "CSV header does not match the supported v3 template or legacy compatibility templates",
  );
}

function getCsvFieldValue(rawRow: string[], indexByHeader: Map<string, number>, headerNames: string[]): string | null {
  for (const headerName of headerNames) {
    const index = indexByHeader.get(normalizeCreatorListHubspotHeader(headerName));

    if (index !== undefined) {
      return rawRow[index] ?? "";
    }
  }

  return null;
}

function getCsvFieldLabel(templateVersion: CsvImportTemplateVersion, headerName: string): string {
  const normalizedHeader = normalizeCreatorListHubspotHeader(headerName);

  if (templateVersion === CSV_IMPORT_TEMPLATE_VERSION) {
    return CSV_IMPORT_V3_LABEL_BY_HEADER.get(normalizedHeader) ?? headerName;
  }

  return CSV_IMPORT_V2_LABEL_BY_HEADER.get(normalizedHeader) ?? headerName;
}

function validateOptionalField(
  label: string,
  value: string | null,
  isValid: (value: string) => boolean,
  errors: string[],
): string | null {
  if (value === null) {
    return null;
  }

  if (!isValid(value)) {
    errors.push(`${label} is invalid`);
    return value;
  }

  return value;
}

function validateRequiredField(
  label: string,
  value: string | null,
  isValid: (value: string) => boolean,
  errors: string[],
): string {
  if (value === null) {
    errors.push(`${label} is required`);
    return "";
  }

  if (!isValid(value)) {
    errors.push(`${label} is invalid`);
    return value;
  }

  return value;
}

function isValidYoutubeChannelId(value: string): boolean {
  return value.length > 0 && value.length <= 200;
}

function isLikelyCanonicalYoutubeChannelId(value: string): boolean {
  return /^UC[a-zA-Z0-9_-]{22}$/.test(value);
}

function isValidChannelTitle(value: string): boolean {
  return value.length > 0 && value.length <= 500;
}

function isValidContactEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidContactName(value: string): boolean {
  return value.length <= 200;
}

function isValidPhoneNumber(value: string): boolean {
  return value.length <= 200;
}

function normalizeCountString(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed || trimmed.length > 50) {
    return null;
  }

  const normalized = trimmed.replace(/[\s,\u00A0]/g, "");

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeRateString(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed || trimmed.length > 50) {
    return null;
  }

  let normalized = trimmed.replace(/[\s\u00A0]/g, "");

  if (normalized.endsWith("%")) {
    normalized = normalized.slice(0, -1);
  }

  if (!normalized) {
    return null;
  }

  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/,/g, "");
  } else if (normalized.includes(",") && !normalized.includes(".")) {
    normalized = normalized.replace(/,/g, ".");
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function isValidCountString(value: string): boolean {
  return normalizeCountString(value) !== null;
}

function isValidRateString(value: string): boolean {
  return normalizeRateString(value) !== null;
}

function isValidTextField(value: string): boolean {
  return value.length <= 200;
}

function isValidUrlField(value: string): boolean {
  if (value.length > 2048) {
    return false;
  }

  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const parsed = new URL(normalized);
    return parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function isValidNotes(value: string): boolean {
  return value.length <= 5000;
}

function isValidSourceLabel(value: string): boolean {
  return value.length <= 200;
}

function validateConfiguredDropdownField(
  label: string,
  value: string | null,
  options: readonly string[],
  errors: string[],
): string | null {
  if (value === null) {
    return null;
  }

  if (!options.includes(value)) {
    errors.push(`${label} must use a saved HubSpot dropdown value`);
  }

  return value;
}

type CsvDropdownOptions = Record<"influencerType" | "influencerVertical" | "countryRegion" | "language", string[]>;

function extractYoutubeChannelIdFromUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalizedValue = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const parsedUrl = new URL(normalizedValue);
    const host = parsedUrl.hostname.replace(/^www\./i, "").toLowerCase();

    if (!host.endsWith("youtube.com")) {
      return null;
    }

    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);

    if (pathParts[0]?.toLowerCase() !== "channel") {
      return null;
    }

    const channelId = pathParts[1]?.trim() ?? "";

    if (!isLikelyCanonicalYoutubeChannelId(channelId)) {
      return null;
    }

    return channelId;
  } catch {
    return null;
  }
}

function normalizeYoutubeHandle(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/\s+/g, "");

  if (!trimmed) {
    return null;
  }

  const withPrefix = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  return withPrefix.toLowerCase();
}

function extractYoutubeHandleFromUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalizedValue = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const parsedUrl = new URL(normalizedValue);
    const host = parsedUrl.hostname.replace(/^www\./i, "").toLowerCase();

    if (!host.endsWith("youtube.com")) {
      return null;
    }

    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    const maybeHandle = pathParts[0]?.trim() ?? "";

    if (!maybeHandle.startsWith("@")) {
      return null;
    }

    return normalizeYoutubeHandle(maybeHandle);
  } catch {
    return null;
  }
}

function getYoutubeHandleLookupVariants(value: string | null): string[] {
  const normalized = normalizeYoutubeHandle(value);

  if (!normalized) {
    return [];
  }

  const withoutPrefix = normalized.replace(/^@+/u, "");

  if (!withoutPrefix) {
    return [normalized];
  }

  return [normalized, withoutPrefix];
}

function parseCountToBigInt(value: string | null): bigint | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeCountString(value);

  if (!normalized) {
    return null;
  }

  return BigInt(normalized);
}

function parseRateToNumber(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeRateString(value);

  if (!normalized) {
    return null;
  }

  return Number(normalized);
}

function toParsedCsvImportRowFromLegacyV2(
  rowNumber: number,
  rawRow: string[],
  template: ParsedCsvHeaderTemplate,
  hubspotDropdownOptions: Record<(typeof CSV_IMPORT_PROFILE_DROPDOWN_FIELD_KEYS)[number], string[]>,
): ParsedCsvImportRow {
  const errors: string[] = [];
  const youtubeChannelId = validateRequiredField(
    getCsvFieldLabel(template.templateVersion, "youtubeChannelId"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["youtubeChannelId"])),
    isValidYoutubeChannelId,
    errors,
  );
  const channelTitle = validateRequiredField(
    getCsvFieldLabel(template.templateVersion, "channelTitle"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["channelTitle"])),
    isValidChannelTitle,
    errors,
  );
  const contactEmail = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "contactEmail"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["contactEmail"]))?.toLowerCase()
    ?? null,
    isValidContactEmail,
    errors,
  );
  const firstName = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "firstName"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["firstName"])),
    isValidContactName,
    errors,
  );
  const lastName = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "lastName"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["lastName"])),
    isValidContactName,
    errors,
  );
  const subscriberCount = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "subscriberCount"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["subscriberCount"])),
    isValidCountString,
    errors,
  );
  const viewCount = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "viewCount"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["viewCount"])),
    isValidCountString,
    errors,
  );
  const videoCount = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "videoCount"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["videoCount"])),
    isValidCountString,
    errors,
  );
  const notes = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "notes"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["notes"])),
    isValidNotes,
    errors,
  );
  const sourceLabel = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "sourceLabel"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["sourceLabel"])),
    isValidSourceLabel,
    errors,
  );
  const influencerType = validateConfiguredDropdownField(
    getCsvFieldLabel(template.templateVersion, "influencerType"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["influencerType"])),
    hubspotDropdownOptions.influencerType,
    errors,
  );
  const influencerVertical = validateConfiguredDropdownField(
    getCsvFieldLabel(template.templateVersion, "influencerVertical"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["influencerVertical"])),
    hubspotDropdownOptions.influencerVertical,
    errors,
  );
  const countryRegion = validateConfiguredDropdownField(
    getCsvFieldLabel(template.templateVersion, "countryRegion"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["countryRegion"])),
    hubspotDropdownOptions.countryRegion,
    errors,
  );
  const language = validateConfiguredDropdownField(
    getCsvFieldLabel(template.templateVersion, "language"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["language"])),
    hubspotDropdownOptions.language,
    errors,
  );

  return {
    rowNumber,
    status: errors.length > 0 ? PrismaCsvImportRowStatus.FAILED : PrismaCsvImportRowStatus.PENDING,
    youtubeChannelId,
    channelTitle,
    hubspotRecordId: null,
    timestampImported: null,
    channelUrl: null,
    campaignName: null,
    dealOwner: null,
    handoffStatus: null,
    contactEmail,
    phoneNumber: null,
    currency: null,
    dealType: null,
    contactType: null,
    month: null,
    year: null,
    clientName: null,
    dealName: null,
    activationName: null,
    pipeline: null,
    dealStage: null,
    firstName,
    lastName,
    youtubeHandle: null,
    youtubeUrl: null,
    subscriberCount,
    viewCount,
    videoCount,
    youtubeVideoMedianViews: null,
    youtubeShortsMedianViews: null,
    youtubeEngagementRate: null,
    youtubeFollowers: subscriberCount,
    instagramHandle: null,
    instagramUrl: null,
    instagramPostAverageViews: null,
    instagramReelAverageViews: null,
    instagramStory7DayAverageViews: null,
    instagramStory30DayAverageViews: null,
    instagramEngagementRate: null,
    instagramFollowers: null,
    tiktokHandle: null,
    tiktokUrl: null,
    tiktokAverageViews: null,
    tiktokEngagementRate: null,
    tiktokFollowers: null,
    twitchHandle: null,
    twitchUrl: null,
    twitchAverageViews: null,
    twitchEngagementRate: null,
    twitchFollowers: null,
    kickHandle: null,
    kickUrl: null,
    kickAverageViews: null,
    kickEngagementRate: null,
    kickFollowers: null,
    xHandle: null,
    xUrl: null,
    xAverageViews: null,
    xEngagementRate: null,
    xFollowers: null,
    notes,
    sourceLabel,
    influencerType,
    influencerVertical,
    countryRegion,
    language,
    errorMessage: errors.length > 0 ? errors.join("; ") : null,
  };
}

function toParsedCsvImportRowFromV3(
  rowNumber: number,
  rawRow: string[],
  template: ParsedCsvHeaderTemplate,
  hubspotDropdownOptions: Record<(typeof CSV_IMPORT_PROFILE_DROPDOWN_FIELD_KEYS)[number], string[]>,
): ParsedCsvImportRow {
  const errors: string[] = [];
  const channelTitle = validateRequiredField(
    getCsvFieldLabel(template.templateVersion, "Channel Name"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Channel Name"])),
    isValidChannelTitle,
    errors,
  );
  const channelUrl = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Channel URL"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Channel URL"])),
    isValidUrlField,
    errors,
  );
  const contactEmail = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Email"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Email"]))?.toLowerCase() ?? null,
    isValidContactEmail,
    errors,
  );
  const phoneNumber = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Phone Number"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Phone Number"])),
    isValidPhoneNumber,
    errors,
  );
  const firstName = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "First Name"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["First Name"])),
    isValidContactName,
    errors,
  );
  const lastName = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Last Name"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Last Name"])),
    isValidContactName,
    errors,
  );
  const influencerType = validateConfiguredDropdownField(
    getCsvFieldLabel(template.templateVersion, "Influencer Type"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Influencer Type"])),
    hubspotDropdownOptions.influencerType,
    errors,
  );
  const influencerVertical = validateConfiguredDropdownField(
    getCsvFieldLabel(template.templateVersion, "Influencer Vertical"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Influencer Vertical"])),
    hubspotDropdownOptions.influencerVertical,
    errors,
  );
  const countryRegion = validateConfiguredDropdownField(
    getCsvFieldLabel(template.templateVersion, "Country/Region"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Country/Region"])),
    hubspotDropdownOptions.countryRegion,
    errors,
  );
  const language = validateConfiguredDropdownField(
    getCsvFieldLabel(template.templateVersion, "Language"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Language"])),
    hubspotDropdownOptions.language,
    errors,
  );
  const youtubeHandle = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "YouTube Handle"),
    normalizeYoutubeHandle(
      toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["YouTube Handle"])),
    ),
    isValidTextField,
    errors,
  );
  const youtubeUrl = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "YouTube URL"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["YouTube URL"])),
    isValidUrlField,
    errors,
  );
  const youtubeVideoMedianViews = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "YouTube Video Median Views"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["YouTube Video Median Views"])),
    isValidCountString,
    errors,
  );
  const youtubeShortsMedianViews = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "YouTube Shorts Median Views"),
    toNullableTrimmed(
      getCsvFieldValue(rawRow, template.indexByHeader, ["YouTube Shorts Median Views"]),
    ),
    isValidCountString,
    errors,
  );
  const youtubeEngagementRate = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "YouTube Engagement Rate"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["YouTube Engagement Rate"])),
    isValidRateString,
    errors,
  );
  const youtubeFollowers = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "YouTube Followers"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["YouTube Followers"])),
    isValidCountString,
    errors,
  );
  const instagramHandle = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Instagram Handle"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Instagram Handle"])),
    isValidTextField,
    errors,
  );
  const instagramUrl = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Instagram URL"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Instagram URL"])),
    isValidUrlField,
    errors,
  );
  const instagramPostAverageViews = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Instagram Post Average Views"),
    toNullableTrimmed(
      getCsvFieldValue(rawRow, template.indexByHeader, ["Instagram Post Average Views"]),
    ),
    isValidCountString,
    errors,
  );
  const instagramReelAverageViews = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Instagram Reel Average Views"),
    toNullableTrimmed(
      getCsvFieldValue(rawRow, template.indexByHeader, ["Instagram Reel Average Views"]),
    ),
    isValidCountString,
    errors,
  );
  const instagramStory7DayAverageViews = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Instagram Story 7-day Average Views"),
    toNullableTrimmed(
      getCsvFieldValue(rawRow, template.indexByHeader, ["Instagram Story 7-day Average Views"]),
    ),
    isValidCountString,
    errors,
  );
  const instagramStory30DayAverageViews = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Instagram Story 30-day Average Views"),
    toNullableTrimmed(
      getCsvFieldValue(rawRow, template.indexByHeader, ["Instagram Story 30-day Average Views"]),
    ),
    isValidCountString,
    errors,
  );
  const instagramEngagementRate = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Instagram Engagement Rate"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Instagram Engagement Rate"])),
    isValidRateString,
    errors,
  );
  const instagramFollowers = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Instagram Followers"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Instagram Followers"])),
    isValidCountString,
    errors,
  );
  const tiktokHandle = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "TikTok Handle"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["TikTok Handle"])),
    isValidTextField,
    errors,
  );
  const tiktokUrl = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "TikTok URL"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["TikTok URL"])),
    isValidUrlField,
    errors,
  );
  const tiktokAverageViews = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "TikTok Average Views"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["TikTok Average Views"])),
    isValidCountString,
    errors,
  );
  const tiktokEngagementRate = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "TikTok Engagement Rate"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["TikTok Engagement Rate"])),
    isValidRateString,
    errors,
  );
  const tiktokFollowers = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "TikTok Followers"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["TikTok Followers"])),
    isValidCountString,
    errors,
  );
  const twitchHandle = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Twitch Handle"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Twitch Handle"])),
    isValidTextField,
    errors,
  );
  const twitchUrl = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Twitch URL"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Twitch URL"])),
    isValidUrlField,
    errors,
  );
  const twitchAverageViews = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Twitch Average Views"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Twitch Average Views"])),
    isValidCountString,
    errors,
  );
  const twitchEngagementRate = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Twitch Engagement Rate"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Twitch Engagement Rate"])),
    isValidRateString,
    errors,
  );
  const twitchFollowers = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Twitch Followers"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Twitch Followers"])),
    isValidCountString,
    errors,
  );
  const kickHandle = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Kick Handle"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Kick Handle"])),
    isValidTextField,
    errors,
  );
  const kickUrl = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Kick URL"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Kick URL"])),
    isValidUrlField,
    errors,
  );
  const kickAverageViews = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Kick Average Views"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Kick Average Views"])),
    isValidCountString,
    errors,
  );
  const kickEngagementRate = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Kick Engagement Rate"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Kick Engagement Rate"])),
    isValidRateString,
    errors,
  );
  const kickFollowers = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "Kick Followers"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["Kick Followers"])),
    isValidCountString,
    errors,
  );
  const xHandle = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "X Handle"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["X Handle"])),
    isValidTextField,
    errors,
  );
  const xUrl = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "X URL"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["X URL"])),
    isValidUrlField,
    errors,
  );
  const xAverageViews = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "X Average Views"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["X Average Views"])),
    isValidCountString,
    errors,
  );
  const xEngagementRate = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "X Engagement Rate"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["X Engagement Rate"])),
    isValidRateString,
    errors,
  );
  const xFollowers = validateOptionalField(
    getCsvFieldLabel(template.templateVersion, "X Followers"),
    toNullableTrimmed(getCsvFieldValue(rawRow, template.indexByHeader, ["X Followers"])),
    isValidCountString,
    errors,
  );

  const derivedYoutubeChannelId =
    extractYoutubeChannelIdFromUrl(youtubeUrl) ?? extractYoutubeChannelIdFromUrl(channelUrl);

  if (!derivedYoutubeChannelId && !youtubeUrl && !channelUrl && !youtubeHandle) {
    errors.push(
      "Provide Channel URL, YouTube URL, YouTube Handle, or a channel-id YouTube URL",
    );
  }

  return {
    rowNumber,
    status: errors.length > 0 ? PrismaCsvImportRowStatus.FAILED : PrismaCsvImportRowStatus.PENDING,
    youtubeChannelId: derivedYoutubeChannelId ?? "",
    channelTitle,
    hubspotRecordId: null,
    timestampImported: null,
    channelUrl,
    campaignName: null,
    dealOwner: null,
    handoffStatus: null,
    contactEmail,
    phoneNumber,
    currency: null,
    dealType: null,
    contactType: null,
    month: null,
    year: null,
    clientName: null,
    dealName: null,
    activationName: null,
    pipeline: null,
    dealStage: null,
    firstName,
    lastName,
    youtubeHandle,
    youtubeUrl,
    subscriberCount: youtubeFollowers,
    viewCount: null,
    videoCount: null,
    youtubeVideoMedianViews,
    youtubeShortsMedianViews,
    youtubeEngagementRate,
    youtubeFollowers,
    instagramHandle,
    instagramUrl,
    instagramPostAverageViews,
    instagramReelAverageViews,
    instagramStory7DayAverageViews,
    instagramStory30DayAverageViews,
    instagramEngagementRate,
    instagramFollowers,
    tiktokHandle,
    tiktokUrl,
    tiktokAverageViews,
    tiktokEngagementRate,
    tiktokFollowers,
    twitchHandle,
    twitchUrl,
    twitchAverageViews,
    twitchEngagementRate,
    twitchFollowers,
    kickHandle,
    kickUrl,
    kickAverageViews,
    kickEngagementRate,
    kickFollowers,
    xHandle,
    xUrl,
    xAverageViews,
    xEngagementRate,
    xFollowers,
    notes: null,
    sourceLabel: null,
    influencerType,
    influencerVertical,
    countryRegion,
    language,
    errorMessage: errors.length > 0 ? errors.join("; ") : null,
  };
}

function toParsedCsvImportRow(
  rowNumber: number,
  rawRow: string[],
  template: ParsedCsvHeaderTemplate,
  hubspotDropdownOptions: Record<(typeof CSV_IMPORT_PROFILE_DROPDOWN_FIELD_KEYS)[number], string[]>,
): ParsedCsvImportRow {
  if (template.templateVersion === CSV_IMPORT_LEGACY_TEMPLATE_VERSION) {
    return toParsedCsvImportRowFromLegacyV2(rowNumber, rawRow, template, hubspotDropdownOptions);
  }

  return toParsedCsvImportRowFromV3(rowNumber, rawRow, template, hubspotDropdownOptions);
}

function assertHubspotDropdownConfiguration(
  dropdownOptions: CsvDropdownOptions,
): void {
  const CSV_DROPDOWN_FIELD_KEYS = ["influencerType", "influencerVertical", "countryRegion", "language"] as const;
  const missingFields = CSV_DROPDOWN_FIELD_KEYS.filter(
    (fieldKey) => dropdownOptions[fieldKey].length === 0,
  );

  if (missingFields.length === 0) {
    return;
  }

  throw new ServiceError(
    "CSV_IMPORT_HUBSPOT_DROPDOWNS_MISSING",
    400,
    "HubSpot dropdown values are not configured. Sync dropdown values from HubSpot before importing CSV.",
  );
}

async function buildParsedRows(csvText: string): Promise<BuildParsedRowsResult> {
  const records = parseCsvRows(csvText);
  const [headerRow, ...dataRows] = records;
  const headerTemplate = parseHeaderTemplate(headerRow);

  if (dataRows.length === 0) {
    throw new ServiceError("CSV_IMPORT_EMPTY", 400, "CSV file must contain at least one data row");
  }

  if (dataRows.length > CSV_IMPORT_MAX_DATA_ROWS) {
    throw new ServiceError(
      "CSV_IMPORT_TOO_MANY_ROWS",
      413,
      `CSV file exceeds the ${CSV_IMPORT_MAX_DATA_ROWS} row limit`,
    );
  }

  const dropdownOptions = await listDropdownOptions();
  const hubspotDropdownOptions = {
    influencerType: dropdownOptions.influencerType,
    influencerVertical: dropdownOptions.influencerVertical,
    countryRegion: dropdownOptions.countryRegion,
    language: dropdownOptions.language,
  };
  assertHubspotDropdownConfiguration(hubspotDropdownOptions);

  return {
    templateVersion: headerTemplate.templateVersion,
    rows: dataRows.map((row, index) =>
      toParsedCsvImportRow(index + 2, row, headerTemplate, hubspotDropdownOptions)
    ),
  };
}

async function getCsvImportBatchSummaryById(importBatchId: string): Promise<CsvImportBatchSummary> {
  const batch = await prisma.csvImportBatch.findUnique({
    where: {
      id: importBatchId,
    },
    select: csvImportBatchSummarySelect,
  });

  if (!batch) {
    throw new ServiceError("CSV_IMPORT_BATCH_NOT_FOUND", 404, "CSV import batch not found");
  }

  return toCsvImportBatchSummary(batch);
}

async function getCsvImportRowCounts(
  client: Pick<typeof prisma.csvImportRow, "count">,
  importBatchId: string,
): Promise<{ importedRowCount: number; failedRowCount: number }> {
  const [importedRowCount, failedRowCount] = await Promise.all([
    client.count({
      where: {
        batchId: importBatchId,
        status: PrismaCsvImportRowStatus.IMPORTED,
      },
    }),
    client.count({
      where: {
        batchId: importBatchId,
        status: PrismaCsvImportRowStatus.FAILED,
      },
    }),
  ]);

  return {
    importedRowCount,
    failedRowCount,
  };
}

async function recordBatchFailureAudit(input: {
  importBatchId: string;
  actorUserId: string;
  fileName: string;
  totalRowCount: number;
  importedRowCount: number;
  failedRowCount: number;
  lastError: string;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorUserId: input.actorUserId,
      action: "csv_import.failed",
      entityType: "csv_import_batch",
      entityId: input.importBatchId,
      metadata: {
        fileName: input.fileName,
        totalRowCount: input.totalRowCount,
        importedRowCount: input.importedRowCount,
        failedRowCount: input.failedRowCount,
        lastError: input.lastError,
      },
    },
  });
}

async function completeBatch(importBatchId: string, actorUserId: string): Promise<void> {
  const batch = await prisma.csvImportBatch.findUnique({
    where: {
      id: importBatchId,
    },
    select: {
      id: true,
      fileName: true,
      totalRowCount: true,
    },
  });

  if (!batch) {
    return;
  }

  const counts = await getCsvImportRowCounts(prisma.csvImportRow, importBatchId);

  await prisma.$transaction(async (tx) => {
    await tx.csvImportBatch.update({
      where: {
        id: importBatchId,
      },
      data: {
        status: PrismaCsvImportBatchStatus.COMPLETED,
        importedRowCount: counts.importedRowCount,
        failedRowCount: counts.failedRowCount,
        completedAt: new Date(),
        lastError: null,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId,
        action: "csv_import.completed",
        entityType: "csv_import_batch",
        entityId: importBatchId,
        metadata: {
          fileName: batch.fileName,
          totalRowCount: batch.totalRowCount,
          importedRowCount: counts.importedRowCount,
          failedRowCount: counts.failedRowCount,
        },
      },
    });
  });
}

async function failBatch(importBatchId: string, actorUserId: string, lastError: string): Promise<void> {
  const batch = await prisma.csvImportBatch.findUnique({
    where: {
      id: importBatchId,
    },
    select: {
      id: true,
      fileName: true,
      totalRowCount: true,
    },
  });

  if (!batch) {
    return;
  }

  const counts = await getCsvImportRowCounts(prisma.csvImportRow, importBatchId);

  await prisma.csvImportBatch.update({
    where: {
      id: importBatchId,
    },
    data: {
      status: PrismaCsvImportBatchStatus.FAILED,
      importedRowCount: counts.importedRowCount,
      failedRowCount: counts.failedRowCount,
      completedAt: new Date(),
      lastError,
    },
  });

  await recordBatchFailureAudit({
    importBatchId,
    actorUserId,
    fileName: batch.fileName,
    totalRowCount: batch.totalRowCount,
    importedRowCount: counts.importedRowCount,
    failedRowCount: counts.failedRowCount,
    lastError,
  });
}

export async function createCsvImportBatch(input: {
  requestedByUserId: string;
  fileName: string;
  fileSize: number;
  csvText: string;
}): Promise<CsvImportBatchSummary> {
  if (input.fileSize > CSV_IMPORT_FILE_SIZE_LIMIT_BYTES) {
    throw new ServiceError(
      "CSV_IMPORT_FILE_TOO_LARGE",
      413,
      "CSV file exceeds the 5 MiB limit",
    );
  }

  const parsedImport = await buildParsedRows(input.csvText);
  const parsedRows = parsedImport.rows;
  const templateVersion = parsedImport.templateVersion;
  let importBatchId = "";
  const pendingRowCount = parsedRows.filter(
    (row) => row.status === PrismaCsvImportRowStatus.PENDING,
  ).length;
  const failedRowCount = parsedRows.length - pendingRowCount;
  const completesImmediately = pendingRowCount === 0;
  const createdAt = new Date();

  await withDbTransaction(async (tx) => {
    const batch = await tx.csvImportBatch.create({
      data: {
        requestedByUserId: input.requestedByUserId,
        fileName: input.fileName.trim() || "upload.csv",
        templateVersion,
        status: completesImmediately
          ? PrismaCsvImportBatchStatus.COMPLETED
          : PrismaCsvImportBatchStatus.QUEUED,
        totalRowCount: parsedRows.length,
        importedRowCount: 0,
        failedRowCount,
        completedAt: completesImmediately ? createdAt : null,
      },
      select: {
        id: true,
      },
    });
    importBatchId = batch.id;

    await tx.csvImportRow.createMany({
      data: parsedRows.map((row) => ({
        batchId: batch.id,
        rowNumber: row.rowNumber,
        status: row.status,
        youtubeChannelId: row.youtubeChannelId,
        channelTitle: row.channelTitle,
        hubspotRecordId: row.hubspotRecordId,
        timestampImported: row.timestampImported,
        channelUrl: row.channelUrl,
        campaignName: row.campaignName,
        dealOwner: row.dealOwner,
        handoffStatus: row.handoffStatus,
        contactEmail: row.contactEmail,
        phoneNumber: row.phoneNumber,
        currency: row.currency,
        dealType: row.dealType,
        contactType: row.contactType,
        month: row.month,
        year: row.year,
        clientName: row.clientName,
        dealName: row.dealName,
        activationName: row.activationName,
        pipeline: row.pipeline,
        dealStage: row.dealStage,
        firstName: row.firstName,
        lastName: row.lastName,
        youtubeHandle: row.youtubeHandle,
        youtubeUrl: row.youtubeUrl,
        subscriberCount: row.subscriberCount,
        viewCount: row.viewCount,
        videoCount: row.videoCount,
        youtubeVideoMedianViews: row.youtubeVideoMedianViews,
        youtubeShortsMedianViews: row.youtubeShortsMedianViews,
        youtubeEngagementRate: row.youtubeEngagementRate,
        youtubeFollowers: row.youtubeFollowers,
        instagramHandle: row.instagramHandle,
        instagramUrl: row.instagramUrl,
        instagramPostAverageViews: row.instagramPostAverageViews,
        instagramReelAverageViews: row.instagramReelAverageViews,
        instagramStory7DayAverageViews: row.instagramStory7DayAverageViews,
        instagramStory30DayAverageViews: row.instagramStory30DayAverageViews,
        instagramEngagementRate: row.instagramEngagementRate,
        instagramFollowers: row.instagramFollowers,
        tiktokHandle: row.tiktokHandle,
        tiktokUrl: row.tiktokUrl,
        tiktokAverageViews: row.tiktokAverageViews,
        tiktokEngagementRate: row.tiktokEngagementRate,
        tiktokFollowers: row.tiktokFollowers,
        twitchHandle: row.twitchHandle,
        twitchUrl: row.twitchUrl,
        twitchAverageViews: row.twitchAverageViews,
        twitchEngagementRate: row.twitchEngagementRate,
        twitchFollowers: row.twitchFollowers,
        kickHandle: row.kickHandle,
        kickUrl: row.kickUrl,
        kickAverageViews: row.kickAverageViews,
        kickEngagementRate: row.kickEngagementRate,
        kickFollowers: row.kickFollowers,
        xHandle: row.xHandle,
        xUrl: row.xUrl,
        xAverageViews: row.xAverageViews,
        xEngagementRate: row.xEngagementRate,
        xFollowers: row.xFollowers,
        notes: row.notes,
        sourceLabel: row.sourceLabel,
        influencerType: row.influencerType,
        influencerVertical: row.influencerVertical,
        countryRegion: row.countryRegion,
        language: row.language,
        errorMessage: row.errorMessage,
        createdAt,
        updatedAt: createdAt,
      })),
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "csv_import.requested",
        entityType: "csv_import_batch",
        entityId: batch.id,
        metadata: {
          fileName: input.fileName.trim() || "upload.csv",
          templateVersion,
          totalRowCount: parsedRows.length,
          failedRowCount,
          queued: !completesImmediately,
        },
      },
    });

    if (completesImmediately) {
      await tx.auditEvent.create({
        data: {
          actorUserId: input.requestedByUserId,
          action: "csv_import.completed",
          entityType: "csv_import_batch",
          entityId: batch.id,
          metadata: {
            fileName: input.fileName.trim() || "upload.csv",
            totalRowCount: parsedRows.length,
            importedRowCount: 0,
            failedRowCount,
          },
        },
      });
    }
  });

  if (!completesImmediately) {
    try {
      await enqueueCsvImportJob({
        importBatchId,
        requestedByUserId: input.requestedByUserId,
      });
    } catch (error) {
      const lastError = formatErrorMessage(error);
      await prisma.csvImportBatch.update({
        where: {
          id: importBatchId,
        },
        data: {
          status: PrismaCsvImportBatchStatus.FAILED,
          lastError,
          completedAt: new Date(),
        },
      });

      await recordBatchFailureAudit({
        importBatchId,
        actorUserId: input.requestedByUserId,
        fileName: input.fileName.trim() || "upload.csv",
        totalRowCount: parsedRows.length,
        importedRowCount: 0,
        failedRowCount,
        lastError,
      });
    }
  }

  return getCsvImportBatchSummaryById(importBatchId);
}

export async function listCsvImportBatches(): Promise<CsvImportBatchSummary[]> {
  const batches = await prisma.csvImportBatch.findMany({
    orderBy: {
      createdAt: "desc",
    },
    select: csvImportBatchSummarySelect,
  });

  return batches.map(toCsvImportBatchSummary);
}

export async function getCsvImportBatchById(input: {
  importBatchId: string;
  page: number;
  pageSize: number;
}): Promise<CsvImportBatchDetail> {
  const skip = (input.page - 1) * input.pageSize;
  const batch = await prisma.csvImportBatch.findUnique({
    where: {
      id: input.importBatchId,
    },
    select: {
      ...csvImportBatchSummarySelect,
      rows: {
        orderBy: {
          rowNumber: "asc",
        },
        skip,
        take: input.pageSize,
        select: csvImportRowSelect,
      },
    },
  });

  if (!batch) {
    throw new ServiceError("CSV_IMPORT_BATCH_NOT_FOUND", 404, "CSV import batch not found");
  }

  return toCsvImportBatchDetail(batch, input.page, input.pageSize);
}

function normalizeUrlForLookup(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname.replace(/\/+$/g, "");

    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

async function applyPendingRow(input: {
  importBatchId: string;
  rowId: string;
  youtubeApiKey: string | null;
}): Promise<void> {
  await withDbTransaction(async (tx) => {
    const row = await tx.csvImportRow.findUnique({
      where: {
        id: input.rowId,
      },
      select: {
        id: true,
        status: true,
        youtubeChannelId: true,
        channelTitle: true,
        channelUrl: true,
        youtubeUrl: true,
        youtubeHandle: true,
        contactEmail: true,
        phoneNumber: true,
        currency: true,
        dealType: true,
        contactType: true,
        month: true,
        year: true,
        clientName: true,
        dealName: true,
        activationName: true,
        pipeline: true,
        dealStage: true,
        hubspotRecordId: true,
        timestampImported: true,
        campaignName: true,
        dealOwner: true,
        handoffStatus: true,
        firstName: true,
        lastName: true,
        subscriberCount: true,
        viewCount: true,
        videoCount: true,
        youtubeVideoMedianViews: true,
        youtubeShortsMedianViews: true,
        youtubeEngagementRate: true,
        youtubeFollowers: true,
        instagramHandle: true,
        instagramUrl: true,
        instagramPostAverageViews: true,
        instagramReelAverageViews: true,
        instagramStory7DayAverageViews: true,
        instagramStory30DayAverageViews: true,
        instagramEngagementRate: true,
        instagramFollowers: true,
        tiktokHandle: true,
        tiktokUrl: true,
        tiktokAverageViews: true,
        tiktokEngagementRate: true,
        tiktokFollowers: true,
        twitchHandle: true,
        twitchUrl: true,
        twitchAverageViews: true,
        twitchEngagementRate: true,
        twitchFollowers: true,
        kickHandle: true,
        kickUrl: true,
        kickAverageViews: true,
        kickEngagementRate: true,
        kickFollowers: true,
        xHandle: true,
        xUrl: true,
        xAverageViews: true,
        xEngagementRate: true,
        xFollowers: true,
        influencerType: true,
        influencerVertical: true,
        countryRegion: true,
        language: true,
      },
    });

    if (!row || row.status !== PrismaCsvImportRowStatus.PENDING) {
      return;
    }

    const normalizedYoutubeHandle = normalizeYoutubeHandle(row.youtubeHandle);
    const youtubeHandleFromYoutubeUrl = extractYoutubeHandleFromUrl(row.youtubeUrl);
    const youtubeHandleFromChannelUrl = extractYoutubeHandleFromUrl(row.channelUrl);
    let preferredYoutubeHandle =
      normalizedYoutubeHandle ?? youtubeHandleFromYoutubeUrl ?? youtubeHandleFromChannelUrl;
    const normalizedYoutubeUrl = normalizeUrlForLookup(row.youtubeUrl ?? row.channelUrl);
    const normalizedChannelUrl = normalizeUrlForLookup(row.channelUrl);
    const normalizedInstagramUrl = normalizeUrlForLookup(row.instagramUrl);
    const normalizedTiktokUrl = normalizeUrlForLookup(row.tiktokUrl);
    const normalizedTwitchUrl = normalizeUrlForLookup(row.twitchUrl);
    const normalizedKickUrl = normalizeUrlForLookup(row.kickUrl);
    const normalizedXUrl = normalizeUrlForLookup(row.xUrl);
    let resolvedYoutubeChannelId = row.youtubeChannelId.trim() || null;
    let preferredYoutubeUrl = normalizedYoutubeUrl
      ?? normalizedChannelUrl
      ?? (resolvedYoutubeChannelId ? `https://www.youtube.com/channel/${resolvedYoutubeChannelId}` : null);

    let createdChannel = false;
    let channel: { id: string } | null = null;

    if (resolvedYoutubeChannelId) {
      channel = await tx.channel.findUnique({
        where: {
          youtubeChannelId: resolvedYoutubeChannelId,
        },
        select: {
          id: true,
        },
      });
    }

    if (!channel && !resolvedYoutubeChannelId) {
      const matchedChannelIds = new Set<string>();

      if (normalizedYoutubeUrl) {
        const urlMatches = await tx.channel.findMany({
          where: {
            youtubeUrl: {
              equals: normalizedYoutubeUrl,
              mode: "insensitive",
            },
          },
          select: {
            id: true,
          },
        });

        if (urlMatches.length > 1) {
          throw new ServiceError(
            "CSV_IMPORT_ROW_CHANNEL_AMBIGUOUS",
            400,
            "Channel URL matches multiple channels",
          );
        }

        if (urlMatches[0]) {
          matchedChannelIds.add(urlMatches[0].id);
        }
      }

      const youtubeHandleLookupCandidates = Array.from(new Set([
        ...getYoutubeHandleLookupVariants(normalizedYoutubeHandle),
        ...getYoutubeHandleLookupVariants(youtubeHandleFromYoutubeUrl),
        ...getYoutubeHandleLookupVariants(youtubeHandleFromChannelUrl),
      ]));

      if (youtubeHandleLookupCandidates.length > 0) {
        const handleMatches = await tx.channel.findMany({
          where: {
            OR: youtubeHandleLookupCandidates.map((handle) => ({
              handle: {
                equals: handle,
                mode: "insensitive",
              },
            })),
          },
          select: {
            id: true,
          },
        });

        if (handleMatches.length > 1) {
          throw new ServiceError(
            "CSV_IMPORT_ROW_CHANNEL_AMBIGUOUS",
            400,
            "YouTube Handle matches multiple channels",
          );
        }

        if (handleMatches[0]) {
          matchedChannelIds.add(handleMatches[0].id);
        }
      }

      if (matchedChannelIds.size > 1) {
        throw new ServiceError(
          "CSV_IMPORT_ROW_CHANNEL_AMBIGUOUS",
          400,
          "Channel URL and YouTube Handle match different channels",
        );
      }

      const matchedChannelId = [...matchedChannelIds][0] ?? null;

      if (matchedChannelId) {
        channel = await tx.channel.findUnique({
          where: {
            id: matchedChannelId,
          },
          select: {
            id: true,
          },
        });
      } else {
        const resolutionCandidates = Array.from(new Set(
          [row.channelUrl, row.youtubeUrl, row.youtubeHandle].filter(
            (value): value is string => Boolean(value?.trim()),
          ),
        ));

        for (const candidate of resolutionCandidates) {
          const resolved = await resolveYoutubeChannelForEnrichment({
            input: candidate,
            channelName: row.channelTitle,
            ...(input.youtubeApiKey ? { apiKey: input.youtubeApiKey } : {}),
          });

          if (!resolved?.channelId) {
            continue;
          }

          resolvedYoutubeChannelId = resolved.channelId;

          if (!preferredYoutubeUrl) {
            preferredYoutubeUrl = normalizeUrlForLookup(resolved.canonicalUrl) ?? resolved.canonicalUrl;
          }

          if (!preferredYoutubeHandle) {
            preferredYoutubeHandle = extractYoutubeHandleFromUrl(resolved.canonicalUrl);
          }

          channel = await tx.channel.findUnique({
            where: {
              youtubeChannelId: resolvedYoutubeChannelId,
            },
            select: {
              id: true,
            },
          });
          break;
        }
      }
    }

    if (!channel && resolvedYoutubeChannelId) {
      if (!preferredYoutubeUrl) {
        preferredYoutubeUrl = `https://www.youtube.com/channel/${resolvedYoutubeChannelId}`;
      }

      channel = await tx.channel.create({
        data: {
          youtubeChannelId: resolvedYoutubeChannelId,
          title: row.channelTitle,
          ...(preferredYoutubeHandle ? { handle: preferredYoutubeHandle } : {}),
          ...(preferredYoutubeUrl ? { youtubeUrl: preferredYoutubeUrl } : {}),
          ...(row.instagramHandle ? { instagramHandle: row.instagramHandle } : {}),
          ...(normalizedInstagramUrl ? { instagramUrl: normalizedInstagramUrl } : {}),
          ...(row.tiktokHandle ? { tiktokHandle: row.tiktokHandle } : {}),
          ...(normalizedTiktokUrl ? { tiktokUrl: normalizedTiktokUrl } : {}),
          ...(row.twitchHandle ? { twitchHandle: row.twitchHandle } : {}),
          ...(normalizedTwitchUrl ? { twitchUrl: normalizedTwitchUrl } : {}),
          ...(row.kickHandle ? { kickHandle: row.kickHandle } : {}),
          ...(normalizedKickUrl ? { kickUrl: normalizedKickUrl } : {}),
          ...(row.xHandle ? { xHandle: row.xHandle } : {}),
          ...(normalizedXUrl ? { xUrl: normalizedXUrl } : {}),
          ...(row.influencerType ? { influencerType: row.influencerType } : {}),
          ...(row.influencerVertical ? { influencerVertical: row.influencerVertical } : {}),
          ...(row.countryRegion ? { countryRegion: row.countryRegion } : {}),
          ...(row.language ? { contentLanguage: row.language } : {}),
        },
        select: {
          id: true,
        },
      });
      createdChannel = true;
    }

    if (!channel && !resolvedYoutubeChannelId) {
      throw new ServiceError(
        "CSV_IMPORT_ROW_CHANNEL_UNRESOLVED",
        400,
        "Unable to resolve channel from Channel URL, YouTube URL, or YouTube Handle",
      );
    }

    if (!channel) {
      throw new ServiceError(
        "CSV_IMPORT_ROW_CHANNEL_UNRESOLVED",
        400,
        "Unable to resolve channel for this import row",
      );
    }

    if (!createdChannel && (
      row.influencerType
      || row.influencerVertical
      || row.countryRegion
      || row.language
      || preferredYoutubeUrl
      || row.instagramHandle
      || normalizedInstagramUrl
      || row.tiktokHandle
      || normalizedTiktokUrl
      || row.twitchHandle
      || normalizedTwitchUrl
      || row.kickHandle
      || normalizedKickUrl
      || row.xHandle
      || normalizedXUrl
    )) {
      await tx.channel.update({
        where: {
          id: channel.id,
        },
        data: {
          ...(preferredYoutubeUrl ? { youtubeUrl: preferredYoutubeUrl } : {}),
          ...(row.instagramHandle ? { instagramHandle: row.instagramHandle } : {}),
          ...(normalizedInstagramUrl ? { instagramUrl: normalizedInstagramUrl } : {}),
          ...(row.tiktokHandle ? { tiktokHandle: row.tiktokHandle } : {}),
          ...(normalizedTiktokUrl ? { tiktokUrl: normalizedTiktokUrl } : {}),
          ...(row.twitchHandle ? { twitchHandle: row.twitchHandle } : {}),
          ...(normalizedTwitchUrl ? { twitchUrl: normalizedTwitchUrl } : {}),
          ...(row.kickHandle ? { kickHandle: row.kickHandle } : {}),
          ...(normalizedKickUrl ? { kickUrl: normalizedKickUrl } : {}),
          ...(row.xHandle ? { xHandle: row.xHandle } : {}),
          ...(normalizedXUrl ? { xUrl: normalizedXUrl } : {}),
          ...(row.influencerType ? { influencerType: row.influencerType } : {}),
          ...(row.influencerVertical ? { influencerVertical: row.influencerVertical } : {}),
          ...(row.countryRegion ? { countryRegion: row.countryRegion } : {}),
          ...(row.language ? { contentLanguage: row.language } : {}),
        },
      });
    }

    if (row.contactEmail) {
      await tx.channelContact.upsert({
        where: {
          channelId_email: {
            channelId: channel.id,
            email: row.contactEmail,
          },
        },
        create: {
          channelId: channel.id,
          email: row.contactEmail,
          firstName: row.firstName,
          lastName: row.lastName,
          phoneNumber: row.phoneNumber,
          csvImportBatchId: input.importBatchId,
        },
        update: {
          firstName: row.firstName,
          lastName: row.lastName,
          phoneNumber: row.phoneNumber,
          csvImportBatchId: input.importBatchId,
        },
      });
    }

    const subscriberCount = row.youtubeFollowers ?? row.subscriberCount;
    const youtubeVideoMedianViews = row.youtubeVideoMedianViews;
    const youtubeShortsMedianViews = row.youtubeShortsMedianViews;
    const youtubeEngagementRate = row.youtubeEngagementRate;
    const instagramPostAverageViews = row.instagramPostAverageViews;
    const instagramReelAverageViews = row.instagramReelAverageViews;
    const instagramStory7DayAverageViews = row.instagramStory7DayAverageViews;
    const instagramStory30DayAverageViews = row.instagramStory30DayAverageViews;
    const instagramEngagementRate = row.instagramEngagementRate;
    const instagramFollowers = row.instagramFollowers;
    const tiktokAverageViews = row.tiktokAverageViews;
    const tiktokEngagementRate = row.tiktokEngagementRate;
    const tiktokFollowers = row.tiktokFollowers;
    const twitchAverageViews = row.twitchAverageViews;
    const twitchEngagementRate = row.twitchEngagementRate;
    const twitchFollowers = row.twitchFollowers;
    const kickAverageViews = row.kickAverageViews;
    const kickEngagementRate = row.kickEngagementRate;
    const kickFollowers = row.kickFollowers;
    const xAverageViews = row.xAverageViews;
    const xEngagementRate = row.xEngagementRate;
    const xFollowers = row.xFollowers;
    const parsedSubscriberCount = parseCountToBigInt(subscriberCount);
    const parsedViewCount = parseCountToBigInt(row.viewCount);
    const parsedVideoCount = parseCountToBigInt(row.videoCount);
    const parsedYoutubeVideoMedianViews = parseCountToBigInt(youtubeVideoMedianViews);
    const parsedYoutubeShortsMedianViews = parseCountToBigInt(youtubeShortsMedianViews);
    const parsedYoutubeEngagementRate = parseRateToNumber(youtubeEngagementRate);
    const parsedInstagramPostAverageViews = parseCountToBigInt(instagramPostAverageViews);
    const parsedInstagramReelAverageViews = parseCountToBigInt(instagramReelAverageViews);
    const parsedInstagramStory7DayAverageViews = parseCountToBigInt(instagramStory7DayAverageViews);
    const parsedInstagramStory30DayAverageViews = parseCountToBigInt(instagramStory30DayAverageViews);
    const parsedInstagramEngagementRate = parseRateToNumber(instagramEngagementRate);
    const parsedInstagramFollowers = parseCountToBigInt(instagramFollowers);
    const parsedTiktokAverageViews = parseCountToBigInt(tiktokAverageViews);
    const parsedTiktokEngagementRate = parseRateToNumber(tiktokEngagementRate);
    const parsedTiktokFollowers = parseCountToBigInt(tiktokFollowers);
    const parsedTwitchAverageViews = parseCountToBigInt(twitchAverageViews);
    const parsedTwitchEngagementRate = parseRateToNumber(twitchEngagementRate);
    const parsedTwitchFollowers = parseCountToBigInt(twitchFollowers);
    const parsedKickAverageViews = parseCountToBigInt(kickAverageViews);
    const parsedKickEngagementRate = parseRateToNumber(kickEngagementRate);
    const parsedKickFollowers = parseCountToBigInt(kickFollowers);
    const parsedXAverageViews = parseCountToBigInt(xAverageViews);
    const parsedXEngagementRate = parseRateToNumber(xEngagementRate);
    const parsedXFollowers = parseCountToBigInt(xFollowers);
    const hasMetricInput = Boolean(
      parsedSubscriberCount
      || parsedViewCount
      || parsedVideoCount
      || parsedYoutubeVideoMedianViews
      || parsedYoutubeShortsMedianViews
      || parsedYoutubeEngagementRate
      || parsedInstagramPostAverageViews
      || parsedInstagramReelAverageViews
      || parsedInstagramStory7DayAverageViews
      || parsedInstagramStory30DayAverageViews
      || parsedInstagramEngagementRate
      || parsedInstagramFollowers
      || parsedTiktokAverageViews
      || parsedTiktokEngagementRate
      || parsedTiktokFollowers
      || parsedTwitchAverageViews
      || parsedTwitchEngagementRate
      || parsedTwitchFollowers
      || parsedKickAverageViews
      || parsedKickEngagementRate
      || parsedKickFollowers
      || parsedXAverageViews
      || parsedXEngagementRate
      || parsedXFollowers,
    );

    if (hasMetricInput) {
      const channelMetricCreateData: Prisma.ChannelMetricUncheckedCreateInput = {
        channelId: channel.id,
        csvImportBatchId: input.importBatchId,
        ...(parsedSubscriberCount ? { subscriberCount: parsedSubscriberCount } : {}),
        ...(parsedSubscriberCount ? { youtubeFollowers: parsedSubscriberCount } : {}),
        ...(parsedViewCount ? { viewCount: parsedViewCount } : {}),
        ...(parsedVideoCount ? { videoCount: parsedVideoCount } : {}),
        ...(parsedYoutubeVideoMedianViews ? { youtubeVideoMedianViews: parsedYoutubeVideoMedianViews } : {}),
        ...(parsedYoutubeShortsMedianViews
          ? { youtubeShortsMedianViews: parsedYoutubeShortsMedianViews }
          : {}),
        ...(parsedYoutubeEngagementRate ? { youtubeEngagementRate: parsedYoutubeEngagementRate } : {}),
        ...(parsedInstagramPostAverageViews
          ? { instagramPostAverageViews: parsedInstagramPostAverageViews }
          : {}),
        ...(parsedInstagramReelAverageViews
          ? { instagramReelAverageViews: parsedInstagramReelAverageViews }
          : {}),
        ...(parsedInstagramStory7DayAverageViews
          ? { instagramStory7DayAverageViews: parsedInstagramStory7DayAverageViews }
          : {}),
        ...(parsedInstagramStory30DayAverageViews
          ? { instagramStory30DayAverageViews: parsedInstagramStory30DayAverageViews }
          : {}),
        ...(parsedInstagramEngagementRate
          ? { instagramEngagementRate: parsedInstagramEngagementRate }
          : {}),
        ...(parsedInstagramFollowers ? { instagramFollowers: parsedInstagramFollowers } : {}),
        ...(parsedTiktokAverageViews ? { tiktokAverageViews: parsedTiktokAverageViews } : {}),
        ...(parsedTiktokEngagementRate ? { tiktokEngagementRate: parsedTiktokEngagementRate } : {}),
        ...(parsedTiktokFollowers ? { tiktokFollowers: parsedTiktokFollowers } : {}),
        ...(parsedTwitchAverageViews ? { twitchAverageViews: parsedTwitchAverageViews } : {}),
        ...(parsedTwitchEngagementRate ? { twitchEngagementRate: parsedTwitchEngagementRate } : {}),
        ...(parsedTwitchFollowers ? { twitchFollowers: parsedTwitchFollowers } : {}),
        ...(parsedKickAverageViews ? { kickAverageViews: parsedKickAverageViews } : {}),
        ...(parsedKickEngagementRate ? { kickEngagementRate: parsedKickEngagementRate } : {}),
        ...(parsedKickFollowers ? { kickFollowers: parsedKickFollowers } : {}),
        ...(parsedXAverageViews ? { xAverageViews: parsedXAverageViews } : {}),
        ...(parsedXEngagementRate ? { xEngagementRate: parsedXEngagementRate } : {}),
        ...(parsedXFollowers ? { xFollowers: parsedXFollowers } : {}),
      };

      await tx.channelMetric.upsert({
        where: {
          channelId: channel.id,
        },
        create: channelMetricCreateData,
        update: {
          csvImportBatchId: input.importBatchId,
          ...(parsedSubscriberCount ? { subscriberCount: parsedSubscriberCount } : {}),
          ...(parsedSubscriberCount ? { youtubeFollowers: parsedSubscriberCount } : {}),
          ...(parsedViewCount ? { viewCount: parsedViewCount } : {}),
          ...(parsedVideoCount ? { videoCount: parsedVideoCount } : {}),
          ...(parsedYoutubeVideoMedianViews ? { youtubeVideoMedianViews: parsedYoutubeVideoMedianViews } : {}),
          ...(parsedYoutubeShortsMedianViews
            ? { youtubeShortsMedianViews: parsedYoutubeShortsMedianViews }
            : {}),
          ...(parsedYoutubeEngagementRate ? { youtubeEngagementRate: parsedYoutubeEngagementRate } : {}),
          ...(parsedInstagramPostAverageViews
            ? { instagramPostAverageViews: parsedInstagramPostAverageViews }
            : {}),
          ...(parsedInstagramReelAverageViews
            ? { instagramReelAverageViews: parsedInstagramReelAverageViews }
            : {}),
          ...(parsedInstagramStory7DayAverageViews
            ? { instagramStory7DayAverageViews: parsedInstagramStory7DayAverageViews }
            : {}),
          ...(parsedInstagramStory30DayAverageViews
            ? { instagramStory30DayAverageViews: parsedInstagramStory30DayAverageViews }
            : {}),
          ...(parsedInstagramEngagementRate
            ? { instagramEngagementRate: parsedInstagramEngagementRate }
            : {}),
          ...(parsedInstagramFollowers ? { instagramFollowers: parsedInstagramFollowers } : {}),
          ...(parsedTiktokAverageViews ? { tiktokAverageViews: parsedTiktokAverageViews } : {}),
          ...(parsedTiktokEngagementRate ? { tiktokEngagementRate: parsedTiktokEngagementRate } : {}),
          ...(parsedTiktokFollowers ? { tiktokFollowers: parsedTiktokFollowers } : {}),
          ...(parsedTwitchAverageViews ? { twitchAverageViews: parsedTwitchAverageViews } : {}),
          ...(parsedTwitchEngagementRate ? { twitchEngagementRate: parsedTwitchEngagementRate } : {}),
          ...(parsedTwitchFollowers ? { twitchFollowers: parsedTwitchFollowers } : {}),
          ...(parsedKickAverageViews ? { kickAverageViews: parsedKickAverageViews } : {}),
          ...(parsedKickEngagementRate ? { kickEngagementRate: parsedKickEngagementRate } : {}),
          ...(parsedKickFollowers ? { kickFollowers: parsedKickFollowers } : {}),
          ...(parsedXAverageViews ? { xAverageViews: parsedXAverageViews } : {}),
          ...(parsedXEngagementRate ? { xEngagementRate: parsedXEngagementRate } : {}),
          ...(parsedXFollowers ? { xFollowers: parsedXFollowers } : {}),
        },
      });
    }

    await tx.csvImportRow.update({
      where: {
        id: row.id,
      },
      data: {
        status: PrismaCsvImportRowStatus.IMPORTED,
        channelId: channel.id,
        errorMessage: null,
      },
    });
  });
}

export async function executeCsvImportBatch(input: {
  importBatchId: string;
  requestedByUserId: string;
}): Promise<void> {
  const batch = await prisma.csvImportBatch.findUnique({
    where: {
      id: input.importBatchId,
    },
    select: {
      id: true,
      requestedByUserId: true,
    },
  });

  if (!batch) {
    return;
  }

  if (batch.requestedByUserId !== input.requestedByUserId) {
    await failBatch(input.importBatchId, batch.requestedByUserId, "CSV import payload user mismatch");
    return;
  }

  const claimed = await prisma.csvImportBatch.updateMany({
    where: {
      id: input.importBatchId,
      status: {
        in: [PrismaCsvImportBatchStatus.QUEUED, PrismaCsvImportBatchStatus.FAILED],
      },
    },
    data: {
      status: PrismaCsvImportBatchStatus.RUNNING,
      startedAt: new Date(),
      completedAt: null,
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  const youtubeApiKey = await getUserYoutubeApiKey(batch.requestedByUserId);

  try {
    const rows = await prisma.csvImportRow.findMany({
      where: {
        batchId: input.importBatchId,
        status: PrismaCsvImportRowStatus.PENDING,
      },
      orderBy: {
        rowNumber: "asc",
      },
      select: {
        id: true,
      },
    });

    for (const row of rows) {
      try {
        await applyPendingRow({
          importBatchId: input.importBatchId,
          rowId: row.id,
          youtubeApiKey,
        });
      } catch (error) {
        await prisma.csvImportRow.update({
          where: {
            id: row.id,
          },
          data: {
            status: PrismaCsvImportRowStatus.FAILED,
            errorMessage: formatErrorMessage(error),
          },
        });
      }
    }

    await completeBatch(input.importBatchId, batch.requestedByUserId);
  } catch (error) {
    await failBatch(input.importBatchId, batch.requestedByUserId, formatErrorMessage(error));
    throw error;
  }
}
