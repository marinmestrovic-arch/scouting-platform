import {
  HubspotImportBatchRowStatus as PrismaHubspotImportBatchRowStatus,
  HubspotImportBatchStatus as PrismaHubspotImportBatchStatus,
  type Prisma,
} from "@prisma/client";
import {
  channelAudienceCountrySchema,
  createHubspotImportBatchRequestSchema,
  HUBSPOT_IMPORT_HEADER,
  HUBSPOT_IMPORT_SCHEMA_VERSION,
  type HubspotImportBatchDetail,
  type HubspotImportBatchRow,
  type HubspotImportBatchStatus,
  type HubspotImportBatchSummary,
  type HubspotImportBlocker,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";

import { ServiceError } from "../errors";
import {
  buildHubspotRowKey,
  normalizeHubspotPrepDefaults,
  resolveHubspotRowValues,
} from "./preparation";
import { enqueueHubspotImportJob } from "./queue";

const batchActorSelect = {
  id: true,
  email: true,
  name: true,
} as const;

const batchSummarySelect = {
  id: true,
  fileName: true,
  schemaVersion: true,
  status: true,
  totalRowCount: true,
  preparedRowCount: true,
  failedRowCount: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
  requestedByUser: {
    select: batchActorSelect,
  },
  runRequest: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

const batchRowOrderBy: Prisma.HubspotImportBatchRowOrderByWithRelationInput[] = [
  {
    channelId: "asc",
  },
  {
    contactEmail: "asc",
  },
];

const batchDetailSelect = {
  ...batchSummarySelect,
  rows: {
    orderBy: batchRowOrderBy,
    select: {
      id: true,
      channelId: true,
      contactEmail: true,
      firstName: true,
      lastName: true,
      payload: true,
      status: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

const runImportSelect = {
  id: true,
  requestedByUserId: true,
  name: true,
  client: true,
  market: true,
  campaignName: true,
  month: true,
  year: true,
  dealOwner: true,
  dealName: true,
  pipeline: true,
  dealStage: true,
  currency: true,
  dealType: true,
  activationType: true,
  hubspotInfluencerType: true,
  hubspotInfluencerVertical: true,
  hubspotCountryRegion: true,
  hubspotLanguage: true,
  hubspotRowOverrides: {
    orderBy: {
      createdAt: "asc",
    },
    select: {
      rowKey: true,
      firstName: true,
      lastName: true,
      email: true,
      currency: true,
      dealType: true,
      activationType: true,
      influencerType: true,
      influencerVertical: true,
      countryRegion: true,
      language: true,
    },
  },
  results: {
    orderBy: {
      rank: "asc",
    },
    select: {
      id: true,
      channel: {
        select: {
          id: true,
          title: true,
          influencerType: true,
          influencerVertical: true,
          countryRegion: true,
          contentLanguage: true,
          contacts: {
            orderBy: {
              email: "asc",
            },
            select: {
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          enrichment: {
            select: {
              topics: true,
            },
          },
          insights: {
            select: {
              audienceCountries: true,
            },
          },
        },
      },
    },
  },
} as const;

type BatchSummaryRecord = Prisma.HubspotImportBatchGetPayload<{
  select: typeof batchSummarySelect;
}>;

type BatchDetailRecord = Prisma.HubspotImportBatchGetPayload<{
  select: typeof batchDetailSelect;
}>;

type ImportRunRecord = Prisma.RunRequestGetPayload<{
  select: typeof runImportSelect;
}>;

type HubspotImportPayload = {
  channelTitle: string;
  csv: Record<(typeof HUBSPOT_IMPORT_HEADER)[number], string>;
};

const REQUIRED_RUN_FIELDS = [
  ["client", "Client name"],
  ["market", "Market"],
  ["campaignName", "Campaign Name"],
  ["month", "Month"],
  ["year", "Year"],
  ["dealOwner", "Deal owner"],
  ["dealName", "Deal name"],
  ["pipeline", "Pipeline"],
  ["dealStage", "Deal stage"],
  ["currency", "Currency"],
  ["dealType", "Deal Type"],
  ["activationType", "Activation Type"],
] as const satisfies ReadonlyArray<readonly [keyof ImportRunRecord, string]>;

function toNullableTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isJsonObject(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll(`"`, `""`)}"`;
}

function buildCsvContent(rows: readonly HubspotImportPayload[]): string {
  const header = HUBSPOT_IMPORT_HEADER.join(",");
  const body = rows.map((row) =>
    HUBSPOT_IMPORT_HEADER.map((column) => escapeCsvCell(row.csv[column] ?? "")).join(","),
  );

  return [header, ...body].join("\n");
}

function toHubspotImportBatchStatus(
  status: PrismaHubspotImportBatchStatus,
): HubspotImportBatchStatus {
  switch (status) {
    case PrismaHubspotImportBatchStatus.RUNNING:
      return "running";
    case PrismaHubspotImportBatchStatus.COMPLETED:
      return "completed";
    case PrismaHubspotImportBatchStatus.FAILED:
      return "failed";
    default:
      return "queued";
  }
}

function getTopAudienceCountryName(value: Prisma.JsonValue | null): string {
  if (!Array.isArray(value)) {
    return "Unknown";
  }

  const parsed = channelAudienceCountrySchema.array().safeParse(value);

  if (!parsed.success || parsed.data.length === 0) {
    return "Unknown";
  }

  return parsed.data
    .slice()
    .sort((left, right) => right.percentage - left.percentage)[0]?.countryName ?? "Unknown";
}

function getInfluencerVertical(topics: Prisma.JsonValue | null): string {
  if (!Array.isArray(topics)) {
    return "General";
  }

  for (const topic of topics) {
    if (typeof topic !== "string") {
      continue;
    }

    const trimmed = topic.trim();

    if (trimmed) {
      return trimmed;
    }
  }

  return "General";
}

function buildImportFileName(runName: string, createdAt: Date): string {
  const slug = runName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "run";
  const timestamp = createdAt.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");

  return `hubspot-import-${slug}-${timestamp}.csv`;
}

function toSummary(batch: BatchSummaryRecord): HubspotImportBatchSummary {
  return {
    id: batch.id,
    run: {
      id: batch.runRequest.id,
      name: batch.runRequest.name,
    },
    fileName: batch.fileName,
    schemaVersion: batch.schemaVersion,
    status: toHubspotImportBatchStatus(batch.status),
    totalRowCount: batch.totalRowCount,
    preparedRowCount: batch.preparedRowCount,
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

function parseRowPayload(payload: Prisma.JsonValue | null | undefined): HubspotImportPayload {
  if (!isJsonObject(payload)) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_PAYLOAD_INVALID",
      500,
      "HubSpot import row payload is invalid",
    );
  }

  const channelTitle = typeof payload.channelTitle === "string" ? payload.channelTitle : "";
  const csvPayload = payload.csv;

  if (!isJsonObject(csvPayload)) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_PAYLOAD_INVALID",
      500,
      "HubSpot import row payload is invalid",
    );
  }

  const csv = {} as Record<(typeof HUBSPOT_IMPORT_HEADER)[number], string>;

  for (const column of HUBSPOT_IMPORT_HEADER) {
    csv[column] = typeof csvPayload[column] === "string" ? csvPayload[column] : "";
  }

  return {
    channelTitle,
    csv,
  };
}

function toRow(row: BatchDetailRecord["rows"][number]): HubspotImportBatchRow {
  const payload = parseRowPayload(row.payload);

  return {
    id: row.id,
    channelId: row.channelId,
    channelTitle: payload.channelTitle,
    contactEmail: row.contactEmail,
    firstName: row.firstName,
    lastName: row.lastName,
    influencerType: payload.csv["Influencer Type"],
    influencerVertical: payload.csv["Influencer Vertical"],
    countryRegion: payload.csv["Country/Region"],
    language: payload.csv.Language,
    status:
      row.status === PrismaHubspotImportBatchRowStatus.PREPARED ? "prepared" : row.status === PrismaHubspotImportBatchRowStatus.FAILED ? "failed" : "pending",
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(batch: BatchDetailRecord): HubspotImportBatchDetail {
  return {
    ...toSummary(batch),
    rows: batch.rows.map(toRow),
  };
}

async function getRunForImport(input: {
  runId: string;
  requestedByUserId: string;
  role: "admin" | "user";
}): Promise<ImportRunRecord> {
  const run = await prisma.runRequest.findUnique({
    where: {
      id: input.runId,
    },
    select: runImportSelect,
  });

  if (!run) {
    throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found");
  }

  if (input.role !== "admin" && run.requestedByUserId !== input.requestedByUserId) {
    throw new ServiceError("RUN_FORBIDDEN", 403, "Forbidden");
  }

  return run;
}

function buildRunFieldBlockers(run: ImportRunRecord): HubspotImportBlocker[] {
  const blockers: HubspotImportBlocker[] = [];

  for (const [field, label] of REQUIRED_RUN_FIELDS) {
    const value = run[field];

    if (typeof value === "string" && toNullableTrimmed(value)) {
      continue;
    }

    if (typeof value === "number" || value !== null) {
      continue;
    }

    blockers.push({
      scope: "run",
      runId: run.id,
      channelId: null,
      contactEmail: null,
      field,
      message: `${label} is required before creating a HubSpot import batch`,
    });
  }

  if (run.results.length === 0) {
    blockers.push({
      scope: "run",
      runId: run.id,
      channelId: null,
      contactEmail: null,
      field: "results",
      message: "Run has no saved creators yet",
    });
  }

  return blockers;
}

function buildRowPayload(input: {
  run: ImportRunRecord;
  channel: ImportRunRecord["results"][number]["channel"];
  values: Record<(typeof HUBSPOT_IMPORT_HEADER)[number] | "Contact Type", string>;
}): HubspotImportPayload {
  return {
    channelTitle: input.channel.title,
    csv: {
      "Contact Type": input.values["Contact Type"],
      "Campaign Name": input.values["Campaign Name"],
      Month: input.values.Month,
      Year: input.values.Year,
      "Client name": input.values["Client name"],
      "Deal owner": input.values["Deal owner"],
      "Deal name": input.values["Deal name"],
      Pipeline: input.values.Pipeline,
      "Deal stage": input.values["Deal stage"],
      Currency: input.values.Currency,
      "Deal Type": input.values["Deal Type"],
      "Activation Type": input.values["Activation Type"],
      "First Name": input.values["First Name"],
      "Last Name": input.values["Last Name"],
      Email: input.values.Email,
      "Influencer Type": input.values["Influencer Type"],
      "Influencer Vertical": input.values["Influencer Vertical"],
      "Country/Region": input.values["Country/Region"],
      Language: input.values.Language,
    },
  };
}

async function buildImportDraft(input: {
  runId: string;
  requestedByUserId: string;
  role: "admin" | "user";
}): Promise<{
  run: ImportRunRecord;
  blockers: HubspotImportBlocker[];
  rows: Array<{
    channelId: string;
    contactEmail: string;
    firstName: string;
    lastName: string;
    payload: HubspotImportPayload;
  }>;
}> {
  const run = await getRunForImport(input);
  const blockers = buildRunFieldBlockers(run);
  const rows: Array<{
    channelId: string;
    contactEmail: string;
    firstName: string;
    lastName: string;
    payload: HubspotImportPayload;
  }> = [];
  const defaults = normalizeHubspotPrepDefaults(run);
  const rowOverrides = new Map<string, ImportRunRecord["hubspotRowOverrides"][number]>(
    run.hubspotRowOverrides.map((row) => [row.rowKey, row]),
  );

  for (const result of run.results) {
    const channel = result.channel;

    if (channel.contacts.length === 0) {
      blockers.push({
        scope: "channel",
        runId: run.id,
        channelId: channel.id,
        contactEmail: null,
        field: "contactEmail",
        message: `${channel.title} does not have a contact email`,
      });
      continue;
    }

    for (const [contactIndex, contact] of channel.contacts.entries()) {
      const rowKey = buildHubspotRowKey({
        resultId: result.id,
        contactEmail: contact.email,
        contactIndex,
      });
      const effectiveValues = resolveHubspotRowValues({
        defaults,
        fallbackValues: {
          channelId: channel.id,
          channelTitle: channel.title,
          contactType: "Influencer",
          campaignName: run.campaignName ?? "",
          month: run.month?.toLowerCase() ?? "",
          year: run.year?.toString() ?? "",
          clientName: run.client ?? "",
          dealOwner: run.dealOwner ?? "",
          dealName: run.dealName ?? "",
          pipeline: run.pipeline ?? "",
          dealStage: run.dealStage ?? "",
          currency: run.currency ?? "",
          dealType: run.dealType ?? "",
          activationType: run.activationType ?? "",
          firstName: contact.firstName ?? "",
          lastName: contact.lastName ?? "",
          email: contact.email,
          influencerType: channel.influencerType ?? run.hubspotInfluencerType ?? "YouTube Creator",
          influencerVertical: channel.influencerVertical ?? getInfluencerVertical(channel.enrichment?.topics ?? null),
          countryRegion: channel.countryRegion ?? getTopAudienceCountryName(channel.insights?.audienceCountries ?? null),
          language: channel.contentLanguage ?? run.hubspotLanguage ?? "",
        },
        rowOverride: rowOverrides.get(rowKey) ?? null,
      });

      if (!toNullableTrimmed(effectiveValues.firstName)) {
        blockers.push({
          scope: "contact",
          runId: run.id,
          channelId: channel.id,
          contactEmail: contact.email,
          field: "firstName",
          message: `${channel.title} contact ${contact.email} is missing First Name`,
        });
      }

      if (!toNullableTrimmed(effectiveValues.lastName)) {
        blockers.push({
          scope: "contact",
          runId: run.id,
          channelId: channel.id,
          contactEmail: contact.email,
          field: "lastName",
          message: `${channel.title} contact ${contact.email} is missing Last Name`,
        });
      }

      if (
        !toNullableTrimmed(effectiveValues.firstName) ||
        !toNullableTrimmed(effectiveValues.lastName) ||
        !toNullableTrimmed(effectiveValues.email)
      ) {
        continue;
      }

      rows.push({
        channelId: channel.id,
        contactEmail: effectiveValues.email ?? "",
        firstName: effectiveValues.firstName ?? "",
        lastName: effectiveValues.lastName ?? "",
        payload: buildRowPayload({
          run,
          channel,
          values: {
            "Contact Type": effectiveValues.contactType ?? "",
            "Campaign Name": effectiveValues.campaignName ?? "",
            Month: effectiveValues.month ?? "",
            Year: effectiveValues.year ?? "",
            "Client name": effectiveValues.clientName ?? "",
            "Deal owner": effectiveValues.dealOwner ?? "",
            "Deal name": effectiveValues.dealName ?? "",
            Pipeline: effectiveValues.pipeline ?? "",
            "Deal stage": effectiveValues.dealStage ?? "",
            Currency: effectiveValues.currency ?? "",
            "Deal Type": effectiveValues.dealType ?? "",
            "Activation Type": effectiveValues.activationType ?? "",
            "First Name": effectiveValues.firstName ?? "",
            "Last Name": effectiveValues.lastName ?? "",
            Email: effectiveValues.email ?? "",
            "Influencer Type": effectiveValues.influencerType ?? "",
            "Influencer Vertical": effectiveValues.influencerVertical ?? "",
            "Country/Region": effectiveValues.countryRegion ?? "",
            Language: effectiveValues.language ?? "",
          },
        }),
      });
    }
  }

  return {
    run,
    blockers,
    rows,
  };
}

export async function getHubspotImportBlockers(input: {
  runId: string;
  requestedByUserId: string;
  role: "admin" | "user";
}): Promise<HubspotImportBlocker[]> {
  createHubspotImportBatchRequestSchema.parse({
    runId: input.runId,
  });

  const draft = await buildImportDraft(input);
  return draft.blockers;
}

async function loadBatchSummary(input: {
  importBatchId: string;
  requestedByUserId: string;
  role: "admin" | "user";
}): Promise<HubspotImportBatchSummary> {
  const batch = await prisma.hubspotImportBatch.findFirst({
    where: {
      id: input.importBatchId,
      ...(input.role === "admin" ? {} : { requestedByUserId: input.requestedByUserId }),
    },
    select: batchSummarySelect,
  });

  if (!batch) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_BATCH_NOT_FOUND",
      404,
      "HubSpot import batch not found",
    );
  }

  return toSummary(batch);
}

export async function createHubspotImportBatch(input: {
  runId: string;
  requestedByUserId: string;
  role: "admin" | "user";
}): Promise<HubspotImportBatchSummary> {
  const draft = await buildImportDraft(input);

  if (draft.blockers.length > 0) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_BLOCKERS",
      409,
      "HubSpot import batch has missing required fields",
    );
  }

  if (draft.rows.length === 0) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_EMPTY",
      409,
      "Run does not have any importable contacts yet",
    );
  }

  const createdAt = new Date();
  const fileName = buildImportFileName(draft.run.name, createdAt);
  let importBatchId = "";

  await withDbTransaction(async (tx) => {
    const batch = await tx.hubspotImportBatch.create({
      data: {
        requestedByUserId: input.requestedByUserId,
        runRequestId: draft.run.id,
        fileName,
        schemaVersion: HUBSPOT_IMPORT_SCHEMA_VERSION,
        totalRowCount: draft.rows.length,
        rows: {
          create: draft.rows.map((row) => ({
            channelId: row.channelId,
            contactEmail: row.contactEmail,
            firstName: row.firstName,
            lastName: row.lastName,
            payload: toJsonValue(row.payload),
            createdAt,
            updatedAt: createdAt,
          })),
        },
      },
      select: {
        id: true,
      },
    });
    importBatchId = batch.id;

    await tx.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "hubspot_import.requested",
        entityType: "hubspot_import_batch",
        entityId: batch.id,
        metadata: {
          runId: draft.run.id,
          totalRowCount: draft.rows.length,
        },
      },
    });
  });

  await enqueueHubspotImportJob({
    importBatchId,
    requestedByUserId: input.requestedByUserId,
  });

  return loadBatchSummary({
    importBatchId,
    requestedByUserId: input.requestedByUserId,
    role: input.role,
  });
}

export async function listHubspotImportBatches(input: {
  requestedByUserId: string;
  role: "admin" | "user";
}): Promise<HubspotImportBatchSummary[]> {
  const where: Prisma.HubspotImportBatchWhereInput =
    input.role === "admin" ? {} : { requestedByUserId: input.requestedByUserId };

  const batches = await prisma.hubspotImportBatch.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    select: batchSummarySelect,
  });

  return batches.map(toSummary);
}

export async function getHubspotImportBatchById(input: {
  importBatchId: string;
  requestedByUserId: string;
  role: "admin" | "user";
}): Promise<HubspotImportBatchDetail> {
  const batch = await prisma.hubspotImportBatch.findFirst({
    where: {
      id: input.importBatchId,
      ...(input.role === "admin" ? {} : { requestedByUserId: input.requestedByUserId }),
    },
    select: batchDetailSelect,
  });

  if (!batch) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_BATCH_NOT_FOUND",
      404,
      "HubSpot import batch not found",
    );
  }

  return toDetail(batch);
}

export async function downloadHubspotImportBatch(input: {
  importBatchId: string;
  requestedByUserId: string;
  role: "admin" | "user";
}): Promise<{ fileName: string; csvContent: string }> {
  const batch = await prisma.hubspotImportBatch.findFirst({
    where: {
      id: input.importBatchId,
      ...(input.role === "admin" ? {} : { requestedByUserId: input.requestedByUserId }),
    },
    select: {
      id: true,
      fileName: true,
      status: true,
      csvContent: true,
    },
  });

  if (!batch) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_BATCH_NOT_FOUND",
      404,
      "HubSpot import batch not found",
    );
  }

  if (batch.status !== PrismaHubspotImportBatchStatus.COMPLETED || !batch.csvContent) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_BATCH_NOT_READY",
      409,
      "HubSpot import batch is not ready for download",
    );
  }

  await prisma.auditEvent.create({
    data: {
      actorUserId: input.requestedByUserId,
      action: "hubspot_import.downloaded",
      entityType: "hubspot_import_batch",
      entityId: batch.id,
    },
  });

  return {
    fileName: batch.fileName,
    csvContent: batch.csvContent,
  };
}

export async function executeHubspotImportBatch(input: {
  importBatchId: string;
  requestedByUserId: string;
}): Promise<void> {
  const batch = await prisma.hubspotImportBatch.findUnique({
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
    await prisma.hubspotImportBatch.update({
      where: {
        id: input.importBatchId,
      },
      data: {
        status: PrismaHubspotImportBatchStatus.FAILED,
        completedAt: new Date(),
        lastError: "HubSpot import payload user mismatch",
      },
    });
    return;
  }

  const claimed = await prisma.hubspotImportBatch.updateMany({
    where: {
      id: input.importBatchId,
      status: {
        in: [PrismaHubspotImportBatchStatus.QUEUED, PrismaHubspotImportBatchStatus.FAILED],
      },
    },
    data: {
      status: PrismaHubspotImportBatchStatus.RUNNING,
      startedAt: new Date(),
      completedAt: null,
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  try {
    const rows = await prisma.hubspotImportBatchRow.findMany({
      where: {
        batchId: input.importBatchId,
      },
      orderBy: [
        {
          channelId: "asc",
        },
        {
          contactEmail: "asc",
        },
      ],
      select: {
        id: true,
        payload: true,
      },
    });

    const csvRows: HubspotImportPayload[] = [];

    for (const row of rows) {
      try {
        const payload = parseRowPayload(row.payload);
        csvRows.push(payload);

        await prisma.hubspotImportBatchRow.update({
          where: {
            id: row.id,
          },
          data: {
            status: PrismaHubspotImportBatchRowStatus.PREPARED,
            errorMessage: null,
          },
        });
      } catch (error) {
        await prisma.hubspotImportBatchRow.update({
          where: {
            id: row.id,
          },
          data: {
            status: PrismaHubspotImportBatchRowStatus.FAILED,
            errorMessage: formatErrorMessage(error),
          },
        });
      }
    }

    const preparedRowCount = await prisma.hubspotImportBatchRow.count({
      where: {
        batchId: input.importBatchId,
        status: PrismaHubspotImportBatchRowStatus.PREPARED,
      },
    });
    const failedRowCount = await prisma.hubspotImportBatchRow.count({
      where: {
        batchId: input.importBatchId,
        status: PrismaHubspotImportBatchRowStatus.FAILED,
      },
    });

    if (preparedRowCount === 0) {
      throw new ServiceError(
        "HUBSPOT_IMPORT_EMPTY_PREPARED",
        500,
        "HubSpot import batch did not produce any CSV rows",
      );
    }

    await prisma.hubspotImportBatch.update({
      where: {
        id: input.importBatchId,
      },
      data: {
        status: PrismaHubspotImportBatchStatus.COMPLETED,
        preparedRowCount,
        failedRowCount,
        csvContent: buildCsvContent(csvRows),
        completedAt: new Date(),
        lastError: null,
      },
    });

    await prisma.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "hubspot_import.completed",
        entityType: "hubspot_import_batch",
        entityId: input.importBatchId,
        metadata: {
          preparedRowCount,
          failedRowCount,
        },
      },
    });
  } catch (error) {
    const lastError = formatErrorMessage(error);
    const preparedRowCount = await prisma.hubspotImportBatchRow.count({
      where: {
        batchId: input.importBatchId,
        status: PrismaHubspotImportBatchRowStatus.PREPARED,
      },
    });
    const failedRowCount = await prisma.hubspotImportBatchRow.count({
      where: {
        batchId: input.importBatchId,
        status: PrismaHubspotImportBatchRowStatus.FAILED,
      },
    });

    await prisma.hubspotImportBatch.update({
      where: {
        id: input.importBatchId,
      },
      data: {
        status: PrismaHubspotImportBatchStatus.FAILED,
        preparedRowCount,
        failedRowCount,
        completedAt: new Date(),
        lastError,
      },
    });

    await prisma.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "hubspot_import.failed",
        entityType: "hubspot_import_batch",
        entityId: input.importBatchId,
        metadata: {
          preparedRowCount,
          failedRowCount,
          lastError,
        },
      },
    });

    throw error;
  }
}
