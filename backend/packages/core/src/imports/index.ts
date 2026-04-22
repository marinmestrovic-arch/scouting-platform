import {
  CsvImportBatchStatus as PrismaCsvImportBatchStatus,
  CsvImportRowStatus as PrismaCsvImportRowStatus,
  type Prisma,
} from "@prisma/client";
import {
  CSV_IMPORT_HEADER,
  CSV_IMPORT_FILE_SIZE_LIMIT_BYTES,
  CSV_IMPORT_MAX_DATA_ROWS,
  CSV_IMPORT_TEMPLATE_VERSION,
  type CsvImportBatchDetail,
  type CsvImportBatchStatus,
  type CsvImportBatchSummary,
  type CsvImportRow,
  type CsvImportRowStatus,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import { parse } from "csv-parse/sync";

import { ServiceError } from "../errors";
import { listDropdownOptions } from "../dropdown-values";
import { enqueueCsvImportJob } from "./queue";
export { stopCsvImportsQueue } from "./queue";

const CSV_IMPORT_PROFILE_DROPDOWN_FIELD_KEYS = [
  "influencerType",
  "influencerVertical",
  "countryRegion",
  "language",
] as const;

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
  contactEmail: true,
  firstName: true,
  lastName: true,
  subscriberCount: true,
  viewCount: true,
  videoCount: true,
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
  contactEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  subscriberCount: string | null;
  viewCount: string | null;
  videoCount: string | null;
  notes: string | null;
  sourceLabel: string | null;
  influencerType: string | null;
  influencerVertical: string | null;
  countryRegion: string | null;
  language: string | null;
  errorMessage: string | null;
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
    contactEmail: row.contactEmail,
    firstName: row.firstName,
    lastName: row.lastName,
    subscriberCount: row.subscriberCount,
    viewCount: row.viewCount,
    videoCount: row.videoCount,
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

function assertHeader(headerRow: string[] | undefined): void {
  if (!headerRow) {
    throw new ServiceError("CSV_IMPORT_HEADER_INVALID", 400, "CSV header does not match the strict template");
  }

  const normalizedHeader = headerRow.map((value) => value.trim());
  const matches =
    normalizedHeader.length === CSV_IMPORT_HEADER.length &&
    normalizedHeader.every((value, index) => value === CSV_IMPORT_HEADER[index]);

  if (!matches) {
    throw new ServiceError("CSV_IMPORT_HEADER_INVALID", 400, "CSV header does not match the strict template");
  }
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

function isValidChannelTitle(value: string): boolean {
  return value.length > 0 && value.length <= 500;
}

function isValidContactEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidContactName(value: string): boolean {
  return value.length <= 200;
}

function isValidCountString(value: string): boolean {
  return value.length <= 30 && /^\d+$/.test(value);
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

function toParsedCsvImportRow(
  rowNumber: number,
  rawRow: string[],
  hubspotDropdownOptions: Record<(typeof CSV_IMPORT_PROFILE_DROPDOWN_FIELD_KEYS)[number], string[]>,
): ParsedCsvImportRow {
  const errors: string[] = [];
  const youtubeChannelId = validateRequiredField(
    "youtubeChannelId",
    toNullableTrimmed(rawRow[0]),
    isValidYoutubeChannelId,
    errors,
  );
  const channelTitle = validateRequiredField(
    "channelTitle",
    toNullableTrimmed(rawRow[1]),
    isValidChannelTitle,
    errors,
  );
  const contactEmail = validateOptionalField(
    "contactEmail",
    toNullableTrimmed(rawRow[2])?.toLowerCase() ?? null,
    isValidContactEmail,
    errors,
  );
  const firstName = validateOptionalField(
    "firstName",
    toNullableTrimmed(rawRow[3]),
    isValidContactName,
    errors,
  );
  const lastName = validateOptionalField(
    "lastName",
    toNullableTrimmed(rawRow[4]),
    isValidContactName,
    errors,
  );
  const subscriberCount = validateOptionalField(
    "subscriberCount",
    toNullableTrimmed(rawRow[5]),
    isValidCountString,
    errors,
  );
  const viewCount = validateOptionalField(
    "viewCount",
    toNullableTrimmed(rawRow[6]),
    isValidCountString,
    errors,
  );
  const videoCount = validateOptionalField(
    "videoCount",
    toNullableTrimmed(rawRow[7]),
    isValidCountString,
    errors,
  );
  const notes = validateOptionalField(
    "notes",
    toNullableTrimmed(rawRow[8]),
    isValidNotes,
    errors,
  );
  const sourceLabel = validateOptionalField(
    "sourceLabel",
    toNullableTrimmed(rawRow[9]),
    isValidSourceLabel,
    errors,
  );
  const influencerType = validateConfiguredDropdownField(
    "influencerType",
    toNullableTrimmed(rawRow[10]),
    hubspotDropdownOptions.influencerType,
    errors,
  );
  const influencerVertical = validateConfiguredDropdownField(
    "influencerVertical",
    toNullableTrimmed(rawRow[11]),
    hubspotDropdownOptions.influencerVertical,
    errors,
  );
  const countryRegion = validateConfiguredDropdownField(
    "countryRegion",
    toNullableTrimmed(rawRow[12]),
    hubspotDropdownOptions.countryRegion,
    errors,
  );
  const language = validateConfiguredDropdownField(
    "language",
    toNullableTrimmed(rawRow[13]),
    hubspotDropdownOptions.language,
    errors,
  );

  return {
    rowNumber,
    status: errors.length > 0 ? PrismaCsvImportRowStatus.FAILED : PrismaCsvImportRowStatus.PENDING,
    youtubeChannelId,
    channelTitle,
    contactEmail,
    firstName,
    lastName,
    subscriberCount,
    viewCount,
    videoCount,
    notes,
    sourceLabel,
    influencerType,
    influencerVertical,
    countryRegion,
    language,
    errorMessage: errors.length > 0 ? errors.join("; ") : null,
  };
}

function assertHubspotDropdownConfiguration(
  dropdownOptions: Record<(typeof CSV_IMPORT_PROFILE_DROPDOWN_FIELD_KEYS)[number], string[]>,
): void {
  const missingFields = CSV_IMPORT_PROFILE_DROPDOWN_FIELD_KEYS.filter(
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

async function buildParsedRows(csvText: string): Promise<ParsedCsvImportRow[]> {
  const records = parseCsvRows(csvText);
  const [headerRow, ...dataRows] = records;
  assertHeader(headerRow);

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

  return dataRows.map((row, index) => toParsedCsvImportRow(index + 2, row, hubspotDropdownOptions));
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

  const parsedRows = await buildParsedRows(input.csvText);
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
        templateVersion: CSV_IMPORT_TEMPLATE_VERSION,
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
        contactEmail: row.contactEmail,
        firstName: row.firstName,
        lastName: row.lastName,
        subscriberCount: row.subscriberCount,
        viewCount: row.viewCount,
        videoCount: row.videoCount,
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
          templateVersion: CSV_IMPORT_TEMPLATE_VERSION,
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

async function applyPendingRow(input: {
  importBatchId: string;
  rowId: string;
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
        contactEmail: true,
        firstName: true,
        lastName: true,
        subscriberCount: true,
        viewCount: true,
        videoCount: true,
        influencerType: true,
        influencerVertical: true,
        countryRegion: true,
        language: true,
      },
    });

    if (!row || row.status !== PrismaCsvImportRowStatus.PENDING) {
      return;
    }

    let channel = await tx.channel.findUnique({
      where: {
        youtubeChannelId: row.youtubeChannelId,
      },
      select: {
        id: true,
      },
    });

    if (!channel) {
      channel = await tx.channel.create({
        data: {
          youtubeChannelId: row.youtubeChannelId,
          title: row.channelTitle,
          ...(row.influencerType ? { influencerType: row.influencerType } : {}),
          ...(row.influencerVertical ? { influencerVertical: row.influencerVertical } : {}),
          ...(row.countryRegion ? { countryRegion: row.countryRegion } : {}),
          ...(row.language ? { contentLanguage: row.language } : {}),
        },
        select: {
          id: true,
        },
      });
    } else if (row.influencerType || row.influencerVertical || row.countryRegion || row.language) {
      await tx.channel.update({
        where: {
          id: channel.id,
        },
        data: {
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
          csvImportBatchId: input.importBatchId,
        },
        update: {
          firstName: row.firstName,
          lastName: row.lastName,
          csvImportBatchId: input.importBatchId,
        },
      });
    }

    if (row.subscriberCount || row.viewCount || row.videoCount) {
      const channelMetricCreateData: Prisma.ChannelMetricUncheckedCreateInput = {
        channelId: channel.id,
        csvImportBatchId: input.importBatchId,
        ...(row.subscriberCount ? { subscriberCount: BigInt(row.subscriberCount) } : {}),
        ...(row.subscriberCount ? { youtubeFollowers: BigInt(row.subscriberCount) } : {}),
        ...(row.viewCount ? { viewCount: BigInt(row.viewCount) } : {}),
        ...(row.videoCount ? { videoCount: BigInt(row.videoCount) } : {}),
      };

      await tx.channelMetric.upsert({
        where: {
          channelId: channel.id,
        },
        create: channelMetricCreateData,
        update: {
          csvImportBatchId: input.importBatchId,
          ...(row.subscriberCount ? { subscriberCount: BigInt(row.subscriberCount) } : {}),
          ...(row.subscriberCount ? { youtubeFollowers: BigInt(row.subscriberCount) } : {}),
          ...(row.viewCount ? { viewCount: BigInt(row.viewCount) } : {}),
          ...(row.videoCount ? { videoCount: BigInt(row.videoCount) } : {}),
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
