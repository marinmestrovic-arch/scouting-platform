import {
  CsvExportBatchStatus as PrismaCsvExportBatchStatus,
  CsvExportScopeType as PrismaCsvExportScopeType,
  type Prisma,
} from "@prisma/client";
import type {
  CatalogChannelFilters,
  CreateCsvExportBatchRequest,
  CsvExportBatchDetail,
  CsvExportBatchScope,
  CsvExportBatchStatus,
  CsvExportBatchSummary,
  CsvExportScopeType,
} from "@scouting-platform/contracts";
import { createCsvExportBatchRequestSchema } from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";

import { recordAuditEvent } from "../audit";
import { listChannels } from "../channels";
import { ServiceError } from "../errors";
import { enqueueCsvExportJob } from "./queue";

export { stopCsvExportsQueue } from "./queue";

export const CSV_EXPORT_SCHEMA_VERSION = "v2";

type CsvExportColumn = {
  readonly key: string;
  readonly label: string;
};

export const CSV_EXPORT_COLUMNS: readonly CsvExportColumn[] = [
  { key: "contactType", label: "Contact Type" },
  { key: "campaignName", label: "Campaign Name" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "clientName", label: "Client name" },
  { key: "dealOwner", label: "Deal owner" },
  { key: "dealName", label: "Deal name" },
  { key: "activationName", label: "Activation name" },
  { key: "pipeline", label: "Pipeline" },
  { key: "dealStage", label: "Deal stage" },
  { key: "currency", label: "Currency" },
  { key: "dealType", label: "Deal Type" },
  { key: "activationType", label: "Activation Type" },
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "phoneNumber", label: "Phone Number" },
  { key: "influencerType", label: "Influencer Type" },
  { key: "influencerVertical", label: "Influencer Vertical" },
  { key: "countryRegion", label: "Country/Region" },
  { key: "language", label: "Language" },
  { key: "youtubeHandle", label: "YouTube Handle" },
  { key: "youtubeUrl", label: "YouTube URL" },
  { key: "youtubeVideoMedianViews", label: "YouTube Video Median Views" },
  { key: "youtubeShortsMedianViews", label: "YouTube Shorts Median Views" },
  { key: "youtubeEngagementRate", label: "YouTube Engagement Rate" },
  { key: "youtubeFollowers", label: "YouTube Followers" },
  { key: "instagramHandle", label: "Instagram Handle" },
  { key: "instagramUrl", label: "Instagram URL" },
  { key: "instagramPostAverageViews", label: "Instagram Post Average Views" },
  { key: "instagramReelAverageViews", label: "Instagram Reel Average Views" },
  { key: "instagramStory7DayAverageViews", label: "Instagram Story 7-day Average Views" },
  { key: "instagramStory30DayAverageViews", label: "Instagram Story 30-day Average Views" },
  { key: "instagramEngagementRate", label: "Instagram Engagement Rate" },
  { key: "instagramFollowers", label: "Instagram Followers" },
  { key: "tiktokHandle", label: "TikTok Handle" },
  { key: "tiktokUrl", label: "TikTok URL" },
  { key: "tiktokAverageViews", label: "TikTok Average Views" },
  { key: "tiktokEngagementRate", label: "TikTok Engagement Rate" },
  { key: "tiktokFollowers", label: "TikTok Followers" },
  { key: "twitchHandle", label: "Twitch Handle" },
  { key: "twitchUrl", label: "Twitch URL" },
  { key: "twitchAverageViews", label: "Twitch Average Views" },
  { key: "twitchEngagementRate", label: "Twitch Engagement Rate" },
  { key: "twitchFollowers", label: "Twitch Followers" },
  { key: "kickHandle", label: "Kick Handle" },
  { key: "kickUrl", label: "Kick URL" },
  { key: "kickAverageViews", label: "Kick Average Views" },
  { key: "kickEngagementRate", label: "Kick Engagement Rate" },
  { key: "kickFollowers", label: "Kick Followers" },
  { key: "xHandle", label: "X Handle" },
  { key: "xUrl", label: "X URL" },
  { key: "xAverageViews", label: "X Average Views" },
  { key: "xEngagementRate", label: "X Engagement Rate" },
  { key: "xFollowers", label: "X Followers" },
];

export const CSV_EXPORT_HEADER = CSV_EXPORT_COLUMNS.map((column) => column.key);
const CSV_EXPORT_CHANNEL_PAGE_SIZE = 500;

const csvExportBatchActorSelect = {
  id: true,
  email: true,
  name: true,
} as const;

const csvExportBatchSummarySelect = {
  id: true,
  scopeType: true,
  fileName: true,
  schemaVersion: true,
  status: true,
  rowCount: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
  requestedByUser: {
    select: csvExportBatchActorSelect,
  },
} as const;

const csvExportBatchDetailSelect = {
  ...csvExportBatchSummarySelect,
  scopePayload: true,
} as const;

const exportChannelSelect = {
  id: true,
  youtubeChannelId: true,
  title: true,
  handle: true,
  youtubeUrl: true,
  instagramHandle: true,
  instagramUrl: true,
  tiktokHandle: true,
  tiktokUrl: true,
  twitchHandle: true,
  twitchUrl: true,
  kickHandle: true,
  kickUrl: true,
  xHandle: true,
  xUrl: true,
  influencerType: true,
  influencerVertical: true,
  countryRegion: true,
  contentLanguage: true,
  updatedAt: true,
  contacts: {
    orderBy: {
      email: "asc",
    },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      phoneNumber: true,
    },
  },
  metrics: {
    select: {
      youtubeEngagementRate: true,
      youtubeFollowers: true,
      youtubeVideoMedianViews: true,
      youtubeShortsMedianViews: true,
      instagramPostAverageViews: true,
      instagramReelAverageViews: true,
      instagramStory7DayAverageViews: true,
      instagramStory30DayAverageViews: true,
      instagramEngagementRate: true,
      instagramFollowers: true,
      tiktokAverageViews: true,
      tiktokEngagementRate: true,
      tiktokFollowers: true,
      twitchAverageViews: true,
      twitchEngagementRate: true,
      twitchFollowers: true,
      kickAverageViews: true,
      kickEngagementRate: true,
      kickFollowers: true,
      xAverageViews: true,
      xEngagementRate: true,
      xFollowers: true,
    },
  },
  enrichment: {
    select: {
      status: true,
      completedAt: true,
      lastEnrichedAt: true,
      summary: true,
      topics: true,
      brandFitNotes: true,
    },
  },
  advancedReportRequests: {
    orderBy: {
      createdAt: "desc",
    },
    take: 1,
    select: {
      status: true,
      completedAt: true,
    },
  },
} as const;

type CsvExportBatchSummaryRecord = Prisma.CsvExportBatchGetPayload<{
  select: typeof csvExportBatchSummarySelect;
}>;

type CsvExportBatchDetailRecord = Prisma.CsvExportBatchGetPayload<{
  select: typeof csvExportBatchDetailSelect;
}>;

type ExportChannelRecord = Prisma.ChannelGetPayload<{
  select: typeof exportChannelSelect;
}>;

type CsvExportDownload = {
  fileName: string;
  csvContent: string;
};

type ExportRow = Record<string, string>;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function uniquePreservingOrder<T extends string>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const unique: T[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    unique.push(value);
  }

  return unique;
}

function normalizeTextArray(values: readonly string[] | undefined): string[] | undefined {
  const normalized = uniquePreservingOrder(
    (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0),
  );

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeFilters(filters: CatalogChannelFilters): CatalogChannelFilters {
  const query = filters.query?.trim();
  const countryRegion = normalizeTextArray(filters.countryRegion);
  const influencerVertical = normalizeTextArray(filters.influencerVertical);
  const influencerType = normalizeTextArray(filters.influencerType);
  const enrichmentStatus = filters.enrichmentStatus
    ? uniquePreservingOrder(filters.enrichmentStatus)
    : undefined;
  const advancedReportStatus = filters.advancedReportStatus
    ? uniquePreservingOrder(filters.advancedReportStatus)
    : undefined;

  return {
    ...(query ? { query } : {}),
    ...(countryRegion ? { countryRegion } : {}),
    ...(influencerVertical ? { influencerVertical } : {}),
    ...(influencerType ? { influencerType } : {}),
    ...(filters.youtubeVideoMedianViewsMin !== undefined
      ? { youtubeVideoMedianViewsMin: filters.youtubeVideoMedianViewsMin }
      : {}),
    ...(filters.youtubeVideoMedianViewsMax !== undefined
      ? { youtubeVideoMedianViewsMax: filters.youtubeVideoMedianViewsMax }
      : {}),
    ...(filters.youtubeShortsMedianViewsMin !== undefined
      ? { youtubeShortsMedianViewsMin: filters.youtubeShortsMedianViewsMin }
      : {}),
    ...(filters.youtubeShortsMedianViewsMax !== undefined
      ? { youtubeShortsMedianViewsMax: filters.youtubeShortsMedianViewsMax }
      : {}),
    ...(filters.youtubeFollowersMin !== undefined
      ? { youtubeFollowersMin: filters.youtubeFollowersMin }
      : {}),
    ...(filters.youtubeFollowersMax !== undefined
      ? { youtubeFollowersMax: filters.youtubeFollowersMax }
      : {}),
    ...(enrichmentStatus && enrichmentStatus.length > 0 ? { enrichmentStatus } : {}),
    ...(advancedReportStatus && advancedReportStatus.length > 0
      ? { advancedReportStatus }
      : {}),
  };
}

function normalizeScope(scope: CreateCsvExportBatchRequest): CsvExportBatchScope {
  if (scope.type === "selected") {
    return {
      type: "selected",
      channelIds: uniquePreservingOrder(scope.channelIds),
    };
  }

  return {
    type: "filtered",
    filters: normalizeFilters(scope.filters),
  };
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toCsvExportBatchStatus(status: PrismaCsvExportBatchStatus): CsvExportBatchStatus {
  switch (status) {
    case PrismaCsvExportBatchStatus.RUNNING:
      return "running";
    case PrismaCsvExportBatchStatus.COMPLETED:
      return "completed";
    case PrismaCsvExportBatchStatus.FAILED:
      return "failed";
    default:
      return "queued";
  }
}

function toCsvExportScopeType(scopeType: PrismaCsvExportScopeType): CsvExportScopeType {
  switch (scopeType) {
    case PrismaCsvExportScopeType.FILTERED:
      return "filtered";
    default:
      return "selected";
  }
}

function fromCsvExportScopeType(scopeType: CsvExportScopeType): PrismaCsvExportScopeType {
  switch (scopeType) {
    case "filtered":
      return PrismaCsvExportScopeType.FILTERED;
    default:
      return PrismaCsvExportScopeType.SELECTED;
  }
}

function buildExportFileName(scope: CsvExportBatchScope, createdAt: Date): string {
  const timestamp = createdAt
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");

  return `creators-${scope.type}-${timestamp}.csv`;
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toCsvExportBatchScope(
  scopeType: PrismaCsvExportScopeType,
  scopePayload: Prisma.JsonValue,
): CsvExportBatchScope {
  if (!isJsonObject(scopePayload)) {
    throw new ServiceError("CSV_EXPORT_SCOPE_INVALID", 500, "CSV export batch scope is invalid");
  }

  const payload = {
    type: toCsvExportScopeType(scopeType),
    ...scopePayload,
  };
  const parsed = createCsvExportBatchRequestSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ServiceError("CSV_EXPORT_SCOPE_INVALID", 500, "CSV export batch scope is invalid");
  }

  return normalizeScope(parsed.data);
}

function toCsvExportBatchSummary(batch: CsvExportBatchSummaryRecord): CsvExportBatchSummary {
  return {
    id: batch.id,
    scopeType: toCsvExportScopeType(batch.scopeType),
    fileName: batch.fileName,
    schemaVersion: batch.schemaVersion,
    status: toCsvExportBatchStatus(batch.status),
    rowCount: batch.rowCount,
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

function toCsvExportBatchDetail(batch: CsvExportBatchDetailRecord): CsvExportBatchDetail {
  return {
    ...toCsvExportBatchSummary(batch),
    scope: toCsvExportBatchScope(batch.scopeType, batch.scopePayload),
  };
}

function toNullableString(value: bigint | null | undefined): string {
  return value === null || value === undefined ? "" : value.toString();
}

function toNullableNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : value.toString();
}

function buildYoutubeUrl(channel: ExportChannelRecord): string {
  const directUrl = channel.youtubeUrl?.trim() ?? "";

  if (directUrl) {
    return directUrl;
  }

  const handle = channel.handle?.trim() ?? "";

  if (handle) {
    return `https://www.youtube.com/${handle.startsWith("@") ? handle : `@${handle}`}`;
  }

  return `https://www.youtube.com/channel/${channel.youtubeChannelId}`;
}

function buildExportRowForContact(
  channel: ExportChannelRecord,
  contact: ExportChannelRecord["contacts"][number] | null,
): ExportRow {
  const metrics = channel.metrics;

  return {
    contactType: "Influencer",
    campaignName: "",
    month: "",
    year: "",
    clientName: "",
    dealOwner: "",
    dealName: "",
    activationName: "",
    pipeline: "",
    dealStage: "",
    currency: "",
    dealType: "",
    activationType: "",
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    email: contact?.email ?? "",
    phoneNumber: contact?.phoneNumber ?? "",
    influencerType: channel.influencerType ?? "",
    influencerVertical: channel.influencerVertical ?? "",
    countryRegion: channel.countryRegion ?? "",
    language: channel.contentLanguage ?? "",
    youtubeHandle: channel.handle ?? "",
    youtubeUrl: buildYoutubeUrl(channel),
    youtubeVideoMedianViews: toNullableString(metrics?.youtubeVideoMedianViews),
    youtubeShortsMedianViews: toNullableString(metrics?.youtubeShortsMedianViews),
    youtubeEngagementRate: toNullableNumber(metrics?.youtubeEngagementRate),
    youtubeFollowers: toNullableString(metrics?.youtubeFollowers),
    instagramHandle: channel.instagramHandle ?? "",
    instagramUrl: channel.instagramUrl ?? "",
    instagramPostAverageViews: toNullableString(metrics?.instagramPostAverageViews),
    instagramReelAverageViews: toNullableString(metrics?.instagramReelAverageViews),
    instagramStory7DayAverageViews: toNullableString(metrics?.instagramStory7DayAverageViews),
    instagramStory30DayAverageViews: toNullableString(metrics?.instagramStory30DayAverageViews),
    instagramEngagementRate: toNullableNumber(metrics?.instagramEngagementRate),
    instagramFollowers: toNullableString(metrics?.instagramFollowers),
    tiktokHandle: channel.tiktokHandle ?? "",
    tiktokUrl: channel.tiktokUrl ?? "",
    tiktokAverageViews: toNullableString(metrics?.tiktokAverageViews),
    tiktokEngagementRate: toNullableNumber(metrics?.tiktokEngagementRate),
    tiktokFollowers: toNullableString(metrics?.tiktokFollowers),
    twitchHandle: channel.twitchHandle ?? "",
    twitchUrl: channel.twitchUrl ?? "",
    twitchAverageViews: toNullableString(metrics?.twitchAverageViews),
    twitchEngagementRate: toNullableNumber(metrics?.twitchEngagementRate),
    twitchFollowers: toNullableString(metrics?.twitchFollowers),
    kickHandle: channel.kickHandle ?? "",
    kickUrl: channel.kickUrl ?? "",
    kickAverageViews: toNullableString(metrics?.kickAverageViews),
    kickEngagementRate: toNullableNumber(metrics?.kickEngagementRate),
    kickFollowers: toNullableString(metrics?.kickFollowers),
    xHandle: channel.xHandle ?? "",
    xUrl: channel.xUrl ?? "",
    xAverageViews: toNullableString(metrics?.xAverageViews),
    xEngagementRate: toNullableNumber(metrics?.xEngagementRate),
    xFollowers: toNullableString(metrics?.xFollowers),
  };
}

function toExportRows(channel: ExportChannelRecord): ExportRow[] {
  if (channel.contacts.length === 0) {
    return [buildExportRowForContact(channel, null)];
  }

  return channel.contacts.map((contact) => buildExportRowForContact(channel, contact));
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll(`"`, `""`)}"`;
}

async function validateSelectedChannelIds(channelIds: string[]): Promise<void> {
  const matchingCount = await prisma.channel.count({
    where: {
      id: {
        in: channelIds,
      },
    },
  });

  if (matchingCount !== channelIds.length) {
    throw new ServiceError(
      "CSV_EXPORT_CHANNELS_INVALID",
      400,
      "One or more selected channels do not exist",
    );
  }
}

async function getCsvExportBatchSummaryById(input: {
  exportBatchId: string;
  requestedByUserId: string;
}): Promise<CsvExportBatchSummary> {
  const batch = await prisma.csvExportBatch.findFirst({
    where: {
      id: input.exportBatchId,
      requestedByUserId: input.requestedByUserId,
    },
    select: csvExportBatchSummarySelect,
  });

  if (!batch) {
    throw new ServiceError("CSV_EXPORT_BATCH_NOT_FOUND", 404, "CSV export batch not found");
  }

  return toCsvExportBatchSummary(batch);
}

async function loadSelectedChannels(channelIds: string[]): Promise<ExportChannelRecord[]> {
  if (channelIds.length === 0) {
    return [];
  }

  const channels = await prisma.channel.findMany({
    where: {
      id: {
        in: channelIds,
      },
    },
    select: exportChannelSelect,
  });
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));

  return channelIds
    .map((channelId) => channelsById.get(channelId) ?? null)
    .filter((channel): channel is ExportChannelRecord => channel !== null);
}

function buildCsvRowsContent(rows: readonly ExportRow[]): string {
  return rows
    .map((row) =>
      CSV_EXPORT_COLUMNS.map((column) => escapeCsvCell(row[column.key] ?? "")).join(","),
    )
    .join("\n");
}

async function buildCsvExport(scope: CsvExportBatchScope): Promise<{
  csvContent: string;
  rowCount: number;
}> {
  const chunks = [CSV_EXPORT_COLUMNS.map((column) => escapeCsvCell(column.label)).join(",")];
  let rowCount = 0;

  if (scope.type === "selected") {
    for (let start = 0; start < scope.channelIds.length; start += CSV_EXPORT_CHANNEL_PAGE_SIZE) {
      const channelIds = scope.channelIds.slice(start, start + CSV_EXPORT_CHANNEL_PAGE_SIZE);
      const channels = await loadSelectedChannels(channelIds);
      const rows = channels.flatMap(toExportRows);

      if (rows.length === 0) {
        continue;
      }

      chunks.push(buildCsvRowsContent(rows));
      rowCount += rows.length;
    }
  } else {
    for (let page = 1; ; page += 1) {
      const summaryPage = await listChannels({
        page,
        pageSize: CSV_EXPORT_CHANNEL_PAGE_SIZE,
        ...(scope.filters.query ? { query: scope.filters.query } : {}),
        ...(scope.filters.countryRegion?.length
          ? { countryRegion: scope.filters.countryRegion }
          : {}),
        ...(scope.filters.influencerVertical?.length
          ? { influencerVertical: scope.filters.influencerVertical }
          : {}),
        ...(scope.filters.influencerType?.length
          ? { influencerType: scope.filters.influencerType }
          : {}),
        ...(scope.filters.youtubeVideoMedianViewsMin !== undefined
          ? { youtubeVideoMedianViewsMin: scope.filters.youtubeVideoMedianViewsMin }
          : {}),
        ...(scope.filters.youtubeVideoMedianViewsMax !== undefined
          ? { youtubeVideoMedianViewsMax: scope.filters.youtubeVideoMedianViewsMax }
          : {}),
        ...(scope.filters.youtubeShortsMedianViewsMin !== undefined
          ? { youtubeShortsMedianViewsMin: scope.filters.youtubeShortsMedianViewsMin }
          : {}),
        ...(scope.filters.youtubeShortsMedianViewsMax !== undefined
          ? { youtubeShortsMedianViewsMax: scope.filters.youtubeShortsMedianViewsMax }
          : {}),
        ...(scope.filters.youtubeFollowersMin !== undefined
          ? { youtubeFollowersMin: scope.filters.youtubeFollowersMin }
          : {}),
        ...(scope.filters.youtubeFollowersMax !== undefined
          ? { youtubeFollowersMax: scope.filters.youtubeFollowersMax }
          : {}),
        ...(scope.filters.enrichmentStatus?.length
          ? { enrichmentStatus: scope.filters.enrichmentStatus }
          : {}),
        ...(scope.filters.advancedReportStatus?.length
          ? { advancedReportStatus: scope.filters.advancedReportStatus }
          : {}),
      });

      if (summaryPage.items.length === 0) {
        break;
      }

      const channels = await loadSelectedChannels(summaryPage.items.map((channel) => channel.id));
      const rows = channels.flatMap(toExportRows);

      if (rows.length > 0) {
        chunks.push(buildCsvRowsContent(rows));
        rowCount += rows.length;
      }

      if (summaryPage.page * summaryPage.pageSize >= summaryPage.total) {
        break;
      }
    }
  }

  return {
    csvContent: chunks.join("\n"),
    rowCount,
  };
}

async function recordExportFailureAudit(input: {
  exportBatchId: string;
  actorUserId: string;
  fileName: string;
  schemaVersion: string;
  scopeType: CsvExportScopeType;
  lastError: string;
}): Promise<void> {
  await recordAuditEvent({
    actorUserId: input.actorUserId,
    action: "csv_export.failed",
    entityType: "csv_export_batch",
    entityId: input.exportBatchId,
    metadata: {
      fileName: input.fileName,
      schemaVersion: input.schemaVersion,
      scopeType: input.scopeType,
      lastError: input.lastError,
    },
  });
}

async function failCsvExportBatch(
  exportBatchId: string,
  actorUserId: string,
  lastError: string,
): Promise<void> {
  const batch = await prisma.csvExportBatch.findUnique({
    where: {
      id: exportBatchId,
    },
    select: {
      id: true,
      fileName: true,
      schemaVersion: true,
      scopeType: true,
    },
  });

  if (!batch) {
    return;
  }

  await prisma.csvExportBatch.update({
    where: {
      id: exportBatchId,
    },
    data: {
      status: PrismaCsvExportBatchStatus.FAILED,
      rowCount: 0,
      csvContent: null,
      completedAt: new Date(),
      lastError,
    },
  });

  await recordExportFailureAudit({
    exportBatchId,
    actorUserId,
    fileName: batch.fileName,
    schemaVersion: batch.schemaVersion,
    scopeType: toCsvExportScopeType(batch.scopeType),
    lastError,
  });
}

export async function createCsvExportBatch(input: {
  requestedByUserId: string;
  scope: CreateCsvExportBatchRequest;
}): Promise<CsvExportBatchSummary> {
  const scope = normalizeScope(input.scope);

  if (scope.type === "selected") {
    await validateSelectedChannelIds(scope.channelIds);
  }

  const createdAt = new Date();
  const fileName = buildExportFileName(scope, createdAt);
  let exportBatchId = "";

  await withDbTransaction(async (tx) => {
    const batch = await tx.csvExportBatch.create({
      data: {
        requestedByUserId: input.requestedByUserId,
        scopeType: fromCsvExportScopeType(scope.type),
        scopePayload:
          scope.type === "selected"
            ? toJsonValue({ channelIds: scope.channelIds })
            : toJsonValue({ filters: scope.filters }),
        schemaVersion: CSV_EXPORT_SCHEMA_VERSION,
        fileName,
      },
      select: {
        id: true,
      },
    });
    exportBatchId = batch.id;

    await tx.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "csv_export.requested",
        entityType: "csv_export_batch",
        entityId: batch.id,
        metadata: {
          fileName,
          schemaVersion: CSV_EXPORT_SCHEMA_VERSION,
          scopeType: scope.type,
          queued: true,
        },
      },
    });
  });

  try {
    await enqueueCsvExportJob({
      exportBatchId,
      requestedByUserId: input.requestedByUserId,
    });
  } catch (error) {
    const lastError = formatErrorMessage(error);
    await failCsvExportBatch(exportBatchId, input.requestedByUserId, lastError);
  }

  return getCsvExportBatchSummaryById({
    exportBatchId,
    requestedByUserId: input.requestedByUserId,
  });
}

export async function listCsvExportBatches(input: {
  requestedByUserId: string;
}): Promise<CsvExportBatchSummary[]> {
  const batches = await prisma.csvExportBatch.findMany({
    where: {
      requestedByUserId: input.requestedByUserId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: csvExportBatchSummarySelect,
  });

  return batches.map(toCsvExportBatchSummary);
}

export async function getCsvExportBatchById(input: {
  exportBatchId: string;
  requestedByUserId: string;
}): Promise<CsvExportBatchDetail> {
  const batch = await prisma.csvExportBatch.findFirst({
    where: {
      id: input.exportBatchId,
      requestedByUserId: input.requestedByUserId,
    },
    select: csvExportBatchDetailSelect,
  });

  if (!batch) {
    throw new ServiceError("CSV_EXPORT_BATCH_NOT_FOUND", 404, "CSV export batch not found");
  }

  return toCsvExportBatchDetail(batch);
}

export async function downloadCsvExportBatch(input: {
  exportBatchId: string;
  requestedByUserId: string;
}): Promise<CsvExportDownload> {
  const batch = await prisma.csvExportBatch.findFirst({
    where: {
      id: input.exportBatchId,
      requestedByUserId: input.requestedByUserId,
    },
    select: {
      id: true,
      fileName: true,
      schemaVersion: true,
      scopeType: true,
      status: true,
      rowCount: true,
      csvContent: true,
    },
  });

  if (!batch) {
    throw new ServiceError("CSV_EXPORT_BATCH_NOT_FOUND", 404, "CSV export batch not found");
  }

  if (batch.status !== PrismaCsvExportBatchStatus.COMPLETED || batch.csvContent === null) {
    throw new ServiceError(
      "CSV_EXPORT_BATCH_NOT_READY",
      409,
      "CSV export batch is not ready for download",
    );
  }

  await recordAuditEvent({
    actorUserId: input.requestedByUserId,
    action: "csv_export.downloaded",
    entityType: "csv_export_batch",
    entityId: input.exportBatchId,
    metadata: {
      fileName: batch.fileName,
      schemaVersion: batch.schemaVersion,
      scopeType: toCsvExportScopeType(batch.scopeType),
      rowCount: batch.rowCount,
    },
  });

  return {
    fileName: batch.fileName,
    csvContent: batch.csvContent,
  };
}

export async function executeCsvExportBatch(input: {
  exportBatchId: string;
  requestedByUserId: string;
}): Promise<void> {
  const batch = await prisma.csvExportBatch.findUnique({
    where: {
      id: input.exportBatchId,
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
    await failCsvExportBatch(
      input.exportBatchId,
      batch.requestedByUserId,
      "CSV export payload user mismatch",
    );
    return;
  }

  const claimed = await prisma.csvExportBatch.updateMany({
    where: {
      id: input.exportBatchId,
      status: {
        in: [PrismaCsvExportBatchStatus.QUEUED, PrismaCsvExportBatchStatus.FAILED],
      },
    },
    data: {
      status: PrismaCsvExportBatchStatus.RUNNING,
      startedAt: new Date(),
      completedAt: null,
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  try {
    const detail = await getCsvExportBatchById({
      exportBatchId: input.exportBatchId,
      requestedByUserId: batch.requestedByUserId,
    });
    const result = await buildCsvExport(detail.scope);

    await withDbTransaction(async (tx) => {
      await tx.csvExportBatch.update({
        where: {
          id: input.exportBatchId,
        },
        data: {
          status: PrismaCsvExportBatchStatus.COMPLETED,
          rowCount: result.rowCount,
          csvContent: result.csvContent,
          completedAt: new Date(),
          lastError: null,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: batch.requestedByUserId,
          action: "csv_export.completed",
          entityType: "csv_export_batch",
          entityId: input.exportBatchId,
          metadata: {
            fileName: detail.fileName,
            schemaVersion: detail.schemaVersion,
            scopeType: detail.scopeType,
            rowCount: result.rowCount,
          },
        },
      });
    });
  } catch (error) {
    await failCsvExportBatch(input.exportBatchId, batch.requestedByUserId, formatErrorMessage(error));
    throw error;
  }
}
