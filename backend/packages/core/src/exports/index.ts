import {
  AdvancedReportRequestStatus as PrismaAdvancedReportRequestStatus,
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
  CsvExportBatchStatus as PrismaCsvExportBatchStatus,
  CsvExportScopeType as PrismaCsvExportScopeType,
  type Prisma,
} from "@prisma/client";
import type {
  CatalogChannelFilters,
  ChannelAdvancedReportStatus,
  ChannelEnrichmentStatus,
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
import { resolveChannelAdvancedReportStatus } from "../approvals/status";
import { listChannels } from "../channels";
import { resolveChannelEnrichmentStatus } from "../enrichment/status";
import { ServiceError } from "../errors";
import { enqueueCsvExportJob } from "./queue";

export { stopCsvExportsQueue } from "./queue";

export const CSV_EXPORT_SCHEMA_VERSION = "v1";
export const CSV_EXPORT_HEADER = [
  "channelId",
  "youtubeChannelId",
  "youtubeChannelUrl",
  "title",
  "handle",
  "contactEmails",
  "subscriberCount",
  "viewCount",
  "videoCount",
  "enrichmentStatus",
  "enrichmentSummary",
  "enrichmentTopics",
  "brandFitNotes",
  "advancedReportStatus",
  "advancedReportCompletedAt",
] as const;
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
  updatedAt: true,
  contacts: {
    orderBy: {
      email: "asc",
    },
    select: {
      email: true,
    },
  },
  metrics: {
    select: {
      subscriberCount: true,
      viewCount: true,
      videoCount: true,
    },
  },
  enrichment: {
    select: {
      status: true,
      completedAt: true,
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

type ExportRow = Record<(typeof CSV_EXPORT_HEADER)[number], string>;

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

function normalizeFilters(filters: CatalogChannelFilters): CatalogChannelFilters {
  const query = filters.query?.trim();
  const enrichmentStatus = filters.enrichmentStatus
    ? uniquePreservingOrder(filters.enrichmentStatus)
    : undefined;
  const advancedReportStatus = filters.advancedReportStatus
    ? uniquePreservingOrder(filters.advancedReportStatus)
    : undefined;

  return {
    ...(query ? { query } : {}),
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

function toTopics(topics: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(topics)) {
    return [];
  }

  const values: string[] = [];

  for (const value of topics) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();

    if (trimmed) {
      values.push(trimmed);
    }
  }

  return values;
}

function toNullableString(value: bigint | null | undefined): string {
  return value === null || value === undefined ? "" : value.toString();
}

function resolveStatuses(channel: ExportChannelRecord): {
  enrichmentStatus: ChannelEnrichmentStatus;
  advancedReportStatus: ChannelAdvancedReportStatus;
} {
  return {
    enrichmentStatus: resolveChannelEnrichmentStatus({
      channelUpdatedAt: channel.updatedAt,
      enrichment: channel.enrichment
        ? {
            status: channel.enrichment.status as PrismaChannelEnrichmentStatus,
            completedAt: channel.enrichment.completedAt,
          }
        : null,
    }),
    advancedReportStatus: resolveChannelAdvancedReportStatus({
      request: channel.advancedReportRequests[0]
        ? {
            status: channel.advancedReportRequests[0].status as PrismaAdvancedReportRequestStatus,
            completedAt: channel.advancedReportRequests[0].completedAt,
          }
        : null,
    }),
  };
}

function toExportRow(channel: ExportChannelRecord): ExportRow {
  const statuses = resolveStatuses(channel);
  const contactEmails = uniquePreservingOrder(channel.contacts.map((contact) => contact.email));
  const topics = uniquePreservingOrder(toTopics(channel.enrichment?.topics ?? null));

  return {
    channelId: channel.id,
    youtubeChannelId: channel.youtubeChannelId,
    youtubeChannelUrl: `https://www.youtube.com/channel/${channel.youtubeChannelId}`,
    title: channel.title,
    handle: channel.handle ?? "",
    contactEmails: contactEmails.join(";"),
    subscriberCount: toNullableString(channel.metrics?.subscriberCount),
    viewCount: toNullableString(channel.metrics?.viewCount),
    videoCount: toNullableString(channel.metrics?.videoCount),
    enrichmentStatus: statuses.enrichmentStatus,
    enrichmentSummary: channel.enrichment?.summary ?? "",
    enrichmentTopics: topics.join(";"),
    brandFitNotes: channel.enrichment?.brandFitNotes ?? "",
    advancedReportStatus: statuses.advancedReportStatus,
    advancedReportCompletedAt: channel.advancedReportRequests[0]?.completedAt?.toISOString() ?? "",
  };
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
    .map((row) => CSV_EXPORT_HEADER.map((column) => escapeCsvCell(row[column])).join(","))
    .join("\n");
}

async function buildCsvExport(scope: CsvExportBatchScope): Promise<{
  csvContent: string;
  rowCount: number;
}> {
  const chunks = [CSV_EXPORT_HEADER.join(",")];
  let rowCount = 0;

  if (scope.type === "selected") {
    for (let start = 0; start < scope.channelIds.length; start += CSV_EXPORT_CHANNEL_PAGE_SIZE) {
      const channelIds = scope.channelIds.slice(start, start + CSV_EXPORT_CHANNEL_PAGE_SIZE);
      const channels = await loadSelectedChannels(channelIds);
      const rows = channels.map(toExportRow);

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
      const rows = channels.map(toExportRow);

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
