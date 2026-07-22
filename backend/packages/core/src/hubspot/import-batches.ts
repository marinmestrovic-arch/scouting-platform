import { randomUUID } from "node:crypto";

import {
  HubspotAssociationStatus as PrismaHubspotAssociationStatus,
  HubspotDeliveryMode as PrismaHubspotDeliveryMode,
  HubspotExternalDeliveryStatus as PrismaHubspotExternalDeliveryStatus,
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
  type HubspotDeliveryMode,
  type HubspotImportBatchRow,
  type HubspotImportBatchStatus,
  type HubspotImportBatchSummary,
  type HubspotImportBlocker,
  type RetryHubspotImportBatchResponse,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import { youtubeChannelContextSchema } from "@scouting-platform/integrations";

import { ServiceError } from "../errors";
import {
  buildHubspotContactExternalKey,
  buildHubspotPreparationHash,
} from "./direct-sync-domain";
import {
  executeDirectHubspotImportBatch,
  getHubspotDirectSyncCreationContext,
  HUBSPOT_DIRECT_SYNC_GRAPH_VERSION,
  retryDirectHubspotImportBatch,
} from "./direct-sync-service";
import {
  buildHubspotCreatorCampaignName,
  buildHubspotRowKey,
  normalizeHubspotPrepDefaults,
  resolveHubspotCreatorLabel,
  resolveHubspotInfluencerTypeFallback,
  resolveHubspotRowValues,
} from "./preparation";
import { enqueueHubspotImportJob } from "./queue";

const batchActorSelect = {
  id: true,
  email: true,
  name: true,
} as const;

const ACTIVE_IMPORT_BATCH_STATUSES: readonly HubspotImportBatchStatus[] = [
  "queued",
  "preparing",
  "running",
  "submitting",
  "submitted",
  "processing",
];

const ACTIVE_PRISMA_IMPORT_BATCH_STATUSES = [
  PrismaHubspotImportBatchStatus.QUEUED,
  PrismaHubspotImportBatchStatus.PREPARING,
  PrismaHubspotImportBatchStatus.RUNNING,
  PrismaHubspotImportBatchStatus.SUBMITTING,
  PrismaHubspotImportBatchStatus.SUBMITTED,
  PrismaHubspotImportBatchStatus.PROCESSING,
] as const;

const HUBSPOT_CSV_FALLBACK_LEASE_MS = 15 * 60 * 1_000;
const HUBSPOT_CSV_FALLBACK_LEASE_LOST = "HUBSPOT_CSV_FALLBACK_LEASE_LOST";

type CsvFallbackLease = Readonly<{
  owner: string;
}>;

const batchSummarySelect = {
  id: true,
  fileName: true,
  schemaVersion: true,
  status: true,
  deliveryMode: true,
  hubspotPortal: {
    select: {
      portalId: true,
    },
  },
  externalJobId: true,
  externalStatus: true,
  providerCorrelationId: true,
  providerResultSummary: true,
  retryCount: true,
  submittedAt: true,
  lastPolledAt: true,
  totalRowCount: true,
  preparedRowCount: true,
  syncedRowCount: true,
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
      externalKey: true,
      hubspotContactId: true,
      hubspotDealId: true,
      associationStatus: true,
      retryable: true,
      attemptCount: true,
      providerErrorCode: true,
      providerCorrelationId: true,
      submittedAt: true,
      completedAt: true,
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
      phoneNumber: true,
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
          youtubeChannelId: true,
          handle: true,
          youtubeUrl: true,
          youtubeContext: {
            select: {
              context: true,
            },
          },
          influencerType: true,
          influencerVertical: true,
          countryRegion: true,
          contentLanguage: true,
          contacts: {
            orderBy: {
              email: "asc",
            },
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phoneNumber: true,
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
          metrics: {
            select: {
              subscriberCount: true,
              youtubeFollowers: true,
              youtubeVideoMedianViews: true,
              youtubeShortsMedianViews: true,
              youtubeEngagementRate: true,
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
  providerSnapshot: {
    youtubeChannelId: string;
    youtubeHandle: string | null;
    youtubeUrl: string;
    subscriberCount: string | null;
    youtubeFollowers: string | null;
    youtubeVideoMedianViews: string | null;
    youtubeShortsMedianViews: string | null;
    youtubeEngagementRate: number | null;
  };
};

const REQUIRED_RUN_FIELDS = [
  ["client", "Client name"],
  ["market", "Market"],
  ["campaignName", "Campaign Name"],
  ["month", "Month"],
  ["year", "Year"],
  ["dealOwner", "Deal owner"],
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
    case PrismaHubspotImportBatchStatus.PREPARING:
      return "preparing";
    case PrismaHubspotImportBatchStatus.RUNNING:
      return "running";
    case PrismaHubspotImportBatchStatus.SUBMITTING:
      return "submitting";
    case PrismaHubspotImportBatchStatus.SUBMITTED:
      return "submitted";
    case PrismaHubspotImportBatchStatus.PROCESSING:
      return "processing";
    case PrismaHubspotImportBatchStatus.COMPLETED:
      return "completed";
    case PrismaHubspotImportBatchStatus.COMPLETED_WITH_ERRORS:
      return "completed_with_errors";
    case PrismaHubspotImportBatchStatus.FAILED:
      return "failed";
    default:
      return "queued";
  }
}

function toHubspotDeliveryMode(mode: PrismaHubspotDeliveryMode): HubspotDeliveryMode {
  return mode === PrismaHubspotDeliveryMode.DIRECT_OBJECT_API
    ? "direct_object_api"
    : "csv_fallback";
}

function toResultSummary(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return isJsonObject(value) ? value : null;
}

function buildHubspotRecordUrl(input: {
  portalId: string | null;
  objectTypeId: "0-1" | "0-3";
  objectId: string | null;
}): string | null {
  if (!input.portalId || !input.objectId) {
    return null;
  }
  return `https://app.hubspot.com/contacts/${encodeURIComponent(input.portalId)}/record/${input.objectTypeId}/${encodeURIComponent(input.objectId)}`;
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

function getPreferredCreatorLabel(
  channel: ImportRunRecord["results"][number]["channel"],
): string {
  const parsedYoutubeContext = youtubeChannelContextSchema.safeParse(
    channel.youtubeContext?.context ?? null,
  );

  return resolveHubspotCreatorLabel({
    channelHandle: channel.handle,
    youtubeContextHandle: parsedYoutubeContext.success
      ? parsedYoutubeContext.data.handle
      : null,
    channelTitle: channel.title,
  });
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
    deliveryMode: toHubspotDeliveryMode(batch.deliveryMode),
    portalId: batch.hubspotPortal?.portalId ?? null,
    externalJobId: batch.externalJobId,
    externalStatus: batch.externalStatus?.toLowerCase() ?? null,
    submittedAt: batch.submittedAt?.toISOString() ?? null,
    lastPolledAt: batch.lastPolledAt?.toISOString() ?? null,
    providerCorrelationId: batch.providerCorrelationId,
    providerResultSummary: toResultSummary(batch.providerResultSummary),
    retryCount: batch.retryCount,
    totalRowCount: batch.totalRowCount,
    preparedRowCount: batch.preparedRowCount,
    syncedRowCount: batch.syncedRowCount,
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
  const rawSnapshot = isJsonObject(payload.providerSnapshot)
    ? payload.providerSnapshot
    : {};
  const stringOrNull = (value: Prisma.JsonValue | undefined): string | null =>
    typeof value === "string" && value.trim() ? value : null;

  return {
    channelTitle,
    csv,
    providerSnapshot: {
      youtubeChannelId: stringOrNull(rawSnapshot.youtubeChannelId) ?? "",
      youtubeHandle: stringOrNull(rawSnapshot.youtubeHandle),
      youtubeUrl: stringOrNull(rawSnapshot.youtubeUrl) ?? "",
      subscriberCount: stringOrNull(rawSnapshot.subscriberCount),
      youtubeFollowers: stringOrNull(rawSnapshot.youtubeFollowers),
      youtubeVideoMedianViews: stringOrNull(rawSnapshot.youtubeVideoMedianViews),
      youtubeShortsMedianViews: stringOrNull(rawSnapshot.youtubeShortsMedianViews),
      youtubeEngagementRate:
        typeof rawSnapshot.youtubeEngagementRate === "number"
          ? rawSnapshot.youtubeEngagementRate
          : null,
    },
  };
}

function toRow(
  row: BatchDetailRecord["rows"][number],
  portalId: string | null,
): HubspotImportBatchRow {
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
    status: row.status.toLowerCase() as HubspotImportBatchRow["status"],
    errorMessage: row.errorMessage,
    hubspotContactId: row.hubspotContactId,
    hubspotDealId: row.hubspotDealId,
    hubspotContactUrl: buildHubspotRecordUrl({
      portalId,
      objectTypeId: "0-1",
      objectId: row.hubspotContactId,
    }),
    hubspotDealUrl: buildHubspotRecordUrl({
      portalId,
      objectTypeId: "0-3",
      objectId: row.hubspotDealId,
    }),
    externalKey: row.externalKey,
    associationStatus: row.associationStatus
      ? (row.associationStatus.toLowerCase() as NonNullable<
          HubspotImportBatchRow["associationStatus"]
        >)
      : null,
    retryable: row.retryable,
    attemptCount: row.attemptCount,
    providerErrorCode: row.providerErrorCode,
    providerCorrelationId: row.providerCorrelationId,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(batch: BatchDetailRecord): HubspotImportBatchDetail {
  return {
    ...toSummary(batch),
    rows: batch.rows.map((row) => toRow(row, batch.hubspotPortal?.portalId ?? null)),
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
    providerSnapshot: {
      youtubeChannelId: input.channel.youtubeChannelId,
      youtubeHandle: input.channel.handle,
      youtubeUrl:
        input.channel.youtubeUrl
        ?? `https://www.youtube.com/channel/${input.channel.youtubeChannelId}`,
      subscriberCount: input.channel.metrics?.subscriberCount?.toString() ?? null,
      youtubeFollowers: input.channel.metrics?.youtubeFollowers?.toString() ?? null,
      youtubeVideoMedianViews:
        input.channel.metrics?.youtubeVideoMedianViews?.toString() ?? null,
      youtubeShortsMedianViews:
        input.channel.metrics?.youtubeShortsMedianViews?.toString() ?? null,
      youtubeEngagementRate: input.channel.metrics?.youtubeEngagementRate ?? null,
    },
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
      "Phone Number": input.values["Phone Number"],
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
    channelContactId: string;
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
    channelContactId: string;
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
    const creatorCampaignName = buildHubspotCreatorCampaignName({
      creatorLabel: getPreferredCreatorLabel(channel),
      campaignName: run.campaignName,
    });

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
          dealName: creatorCampaignName,
          pipeline: run.pipeline ?? "",
          dealStage: run.dealStage ?? "",
          currency: run.currency ?? "",
          dealType: run.dealType ?? "",
          activationType: run.activationType ?? "",
          firstName: contact.firstName ?? "",
          lastName: contact.lastName ?? "",
          email: contact.email,
          phoneNumber: contact.phoneNumber ?? "",
          influencerType: resolveHubspotInfluencerTypeFallback({
            channelInfluencerType: channel.influencerType,
            runHubspotInfluencerType: run.hubspotInfluencerType,
          }),
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
        channelContactId: contact.id,
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
            "Phone Number": effectiveValues.phoneNumber ?? "",
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

type PersistedImportBatchOwner = {
  id: string;
  requestedByUserId: string;
  deliveryMode: PrismaHubspotDeliveryMode;
};

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "P2002";
}

async function markHubspotImportEnqueueFailure(input: {
  batch: PersistedImportBatchOwner;
  error: unknown;
}): Promise<void> {
  const direct = input.batch.deliveryMode === PrismaHubspotDeliveryMode.DIRECT_OBJECT_API;
  const lastError = `${direct ? "HubSpot sync" : "HubSpot import"} queue unavailable: ${formatErrorMessage(input.error)}`
    .slice(0, 2_000);
  const completedAt = new Date();

  await withDbTransaction(async (tx) => {
    const updated = await tx.hubspotImportBatch.updateMany({
      where: {
        id: input.batch.id,
        requestedByUserId: input.batch.requestedByUserId,
        deliveryMode: input.batch.deliveryMode,
        status: { in: [...ACTIVE_PRISMA_IMPORT_BATCH_STATUSES] },
        ...(direct
          ? {
              OR: [
                { phaseLeaseOwner: null },
                { phaseLeaseExpiresAt: { lte: completedAt } },
              ],
            }
          : {}),
      },
      data: {
        status: PrismaHubspotImportBatchStatus.FAILED,
        ...(direct
          ? { externalStatus: PrismaHubspotExternalDeliveryStatus.FAILED }
          : {}),
        completedAt,
        nextRetryAt: null,
        ...(direct
          ? { phaseLeaseOwner: null, phaseLeaseExpiresAt: null }
          : {}),
        lastError,
      },
    });
    if (updated.count === 0) {
      return;
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: input.batch.requestedByUserId,
        action: direct
          ? "hubspot_sync.enqueue_failed"
          : "hubspot_import.enqueue_failed",
        entityType: "hubspot_import_batch",
        entityId: input.batch.id,
        metadata: {
          deliveryMode: direct ? "direct_object_api" : "csv_fallback",
          lastError,
        },
      },
    });
  });
}

async function reuseHubspotImportBatch(input: {
  batch: PersistedImportBatchOwner;
  requestedByUserId: string;
  role: "admin" | "user";
}): Promise<HubspotImportBatchSummary> {
  const summary = await loadBatchSummary({
    importBatchId: input.batch.id,
    requestedByUserId: input.requestedByUserId,
    role: input.role,
  });

  if (ACTIVE_IMPORT_BATCH_STATUSES.includes(summary.status)) {
    try {
      await enqueueHubspotImportJob({
        importBatchId: input.batch.id,
        requestedByUserId: input.batch.requestedByUserId,
      });
    } catch (error) {
      await markHubspotImportEnqueueFailure({ batch: input.batch, error });
      throw error;
    }
  }

  return { ...summary, reusedActiveBatch: true };
}

export async function createHubspotImportBatch(input: {
  runId: string;
  requestedByUserId: string;
  role: "admin" | "user";
  deliveryMode?: HubspotDeliveryMode;
}): Promise<HubspotImportBatchSummary> {
  const request = createHubspotImportBatchRequestSchema.parse({
    runId: input.runId,
    deliveryMode: input.deliveryMode,
  });
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

  const deliveryMode = request.deliveryMode ?? "csv_fallback";
  const preparationHash = buildHubspotPreparationHash(
    draft.rows.map((row) => ({
      channelContactId: row.channelContactId,
      payload: row.payload,
    })),
  );
  const directContext = deliveryMode === "direct_object_api"
    ? await getHubspotDirectSyncCreationContext({
        runId: draft.run.id,
        preparedPayloads: draft.rows.map(
          (row) => toJsonValue(row.payload) as Prisma.JsonValue,
        ),
      })
    : null;
  const idempotencyKey = directContext
    ? `run:${draft.run.id}:${preparationHash}:graph:${HUBSPOT_DIRECT_SYNC_GRAPH_VERSION}`
    : null;

  if (directContext && idempotencyKey) {
    const existing = await prisma.hubspotImportBatch.findUnique({
      where: {
        hubspotPortalId_idempotencyKey: {
          hubspotPortalId: directContext.portalDatabaseId,
          idempotencyKey,
        },
      },
      select: {
        id: true,
        requestedByUserId: true,
        deliveryMode: true,
      },
    });

    if (existing) {
      return reuseHubspotImportBatch({
        batch: existing,
        requestedByUserId: input.requestedByUserId,
        role: input.role,
      });
    }
  }

  const createdAt = new Date();
  const fileName = buildImportFileName(draft.run.name, createdAt);
  const persistedDeliveryMode = deliveryMode === "direct_object_api"
    ? PrismaHubspotDeliveryMode.DIRECT_OBJECT_API
    : PrismaHubspotDeliveryMode.CSV_FALLBACK;
  let importBatchId: string;

  try {
    importBatchId = await withDbTransaction(async (tx) => {
      const batch = await tx.hubspotImportBatch.create({
        data: {
          requestedByUserId: input.requestedByUserId,
          runRequestId: draft.run.id,
          hubspotPortalId: directContext?.portalDatabaseId ?? null,
          fileName,
          schemaVersion: HUBSPOT_IMPORT_SCHEMA_VERSION,
          deliveryMode: persistedDeliveryMode,
          idempotencyKey,
          preparationHash,
          ...(directContext
            ? { directSyncSnapshot: toJsonValue(directContext.snapshot) }
            : {}),
          totalRowCount: draft.rows.length,
          rows: {
            create: draft.rows.map((row) => ({
              channelId: row.channelId,
              channelContactId: row.channelContactId,
              contactEmail: row.contactEmail,
              firstName: row.firstName,
              lastName: row.lastName,
              externalKey: buildHubspotContactExternalKey(row.channelContactId),
              associationStatus: deliveryMode === "direct_object_api"
                ? PrismaHubspotAssociationStatus.PENDING
                : PrismaHubspotAssociationStatus.NOT_REQUIRED,
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

      await tx.auditEvent.create({
        data: {
          actorUserId: input.requestedByUserId,
          action: deliveryMode === "direct_object_api"
            ? "hubspot_sync.requested"
            : "hubspot_import.requested",
          entityType: "hubspot_import_batch",
          entityId: batch.id,
          metadata: {
            runId: draft.run.id,
            deliveryMode,
            totalRowCount: draft.rows.length,
          },
        },
      });
      return batch.id;
    });
  } catch (error) {
    if (directContext && idempotencyKey && isPrismaUniqueConstraintError(error)) {
      const winner = await prisma.hubspotImportBatch.findUnique({
        where: {
          hubspotPortalId_idempotencyKey: {
            hubspotPortalId: directContext.portalDatabaseId,
            idempotencyKey,
          },
        },
        select: {
          id: true,
          requestedByUserId: true,
          deliveryMode: true,
        },
      });
      if (winner) {
        return reuseHubspotImportBatch({
          batch: winner,
          requestedByUserId: input.requestedByUserId,
          role: input.role,
        });
      }
    }
    throw error;
  }

  try {
    await enqueueHubspotImportJob({
      importBatchId,
      requestedByUserId: input.requestedByUserId,
    });
  } catch (error) {
    await markHubspotImportEnqueueFailure({
      batch: {
        id: importBatchId,
        requestedByUserId: input.requestedByUserId,
        deliveryMode: persistedDeliveryMode,
      },
      error,
    });
    throw error;
  }

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

export async function retryHubspotImportBatch(input: {
  importBatchId: string;
  requestedByUserId: string;
  role: "admin" | "user";
}): Promise<RetryHubspotImportBatchResponse> {
  const batch = await prisma.hubspotImportBatch.findFirst({
    where: {
      id: input.importBatchId,
      ...(input.role === "admin" ? {} : { requestedByUserId: input.requestedByUserId }),
    },
    select: { id: true, deliveryMode: true, requestedByUserId: true },
  });
  if (!batch) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_BATCH_NOT_FOUND",
      404,
      "HubSpot import batch not found",
    );
  }
  if (batch.deliveryMode !== PrismaHubspotDeliveryMode.DIRECT_OBJECT_API) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_RETRY_UNSUPPORTED",
      409,
      "Failed-row retry is available only for direct HubSpot sync batches",
    );
  }

  const retriedRowCount = await retryDirectHubspotImportBatch({
    importBatchId: input.importBatchId,
    batchOwnerUserId: batch.requestedByUserId,
    actorUserId: input.requestedByUserId,
  });
  const summary = await loadBatchSummary(input);
  return { batch: summary, retriedRowCount };
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

function csvFallbackLeaseLostError(): ServiceError {
  return new ServiceError(
    HUBSPOT_CSV_FALLBACK_LEASE_LOST,
    409,
    "HubSpot CSV fallback execution ownership was lost",
  );
}

function isCsvFallbackLeaseLost(error: unknown): boolean {
  return error instanceof ServiceError && error.code === HUBSPOT_CSV_FALLBACK_LEASE_LOST;
}

async function withCsvFallbackLease<T>(
  importBatchId: string,
  lease: CsvFallbackLease,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withDbTransaction(async (tx) => {
    const renewed = await tx.hubspotImportBatch.updateMany({
      where: {
        id: importBatchId,
        deliveryMode: PrismaHubspotDeliveryMode.CSV_FALLBACK,
        status: PrismaHubspotImportBatchStatus.RUNNING,
        phaseLeaseOwner: lease.owner,
      },
      data: {
        phaseLeaseExpiresAt: new Date(Date.now() + HUBSPOT_CSV_FALLBACK_LEASE_MS),
      },
    });
    if (renewed.count !== 1) {
      throw csvFallbackLeaseLostError();
    }
    return callback(tx);
  });
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
      deliveryMode: true,
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

  if (batch.deliveryMode === PrismaHubspotDeliveryMode.DIRECT_OBJECT_API) {
    await executeDirectHubspotImportBatch(input);
    return;
  }

  const claimedAt = new Date();
  const staleUnleasedBefore = new Date(
    claimedAt.getTime() - HUBSPOT_CSV_FALLBACK_LEASE_MS,
  );
  const lease: CsvFallbackLease = { owner: randomUUID() };
  const claimed = await prisma.hubspotImportBatch.updateMany({
    where: {
      id: input.importBatchId,
      deliveryMode: PrismaHubspotDeliveryMode.CSV_FALLBACK,
      OR: [
        {
          status: {
            in: [PrismaHubspotImportBatchStatus.QUEUED, PrismaHubspotImportBatchStatus.FAILED],
          },
        },
        {
          status: PrismaHubspotImportBatchStatus.RUNNING,
          OR: [
            { phaseLeaseExpiresAt: { lte: claimedAt } },
            {
              phaseLeaseExpiresAt: null,
              updatedAt: { lte: staleUnleasedBefore },
            },
          ],
        },
      ],
    },
    data: {
      status: PrismaHubspotImportBatchStatus.RUNNING,
      phaseLeaseOwner: lease.owner,
      phaseLeaseExpiresAt: new Date(claimedAt.getTime() + HUBSPOT_CSV_FALLBACK_LEASE_MS),
      startedAt: claimedAt,
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
      let payload: HubspotImportPayload | null = null;
      let rowError: string | null = null;
      try {
        payload = parseRowPayload(row.payload);
      } catch (error) {
        rowError = formatErrorMessage(error);
      }

      if (payload) {
        csvRows.push(payload);
      }
      await withCsvFallbackLease(input.importBatchId, lease, async (tx) => {
        await tx.hubspotImportBatchRow.updateMany({
          where: {
            id: row.id,
            batchId: input.importBatchId,
          },
          data: payload
            ? {
                status: PrismaHubspotImportBatchRowStatus.PREPARED,
                errorMessage: null,
              }
            : {
                status: PrismaHubspotImportBatchRowStatus.FAILED,
                errorMessage: rowError ?? "HubSpot import row payload is invalid",
              },
        });
      });
    }

    await withCsvFallbackLease(input.importBatchId, lease, async (tx) => {
      const [preparedRowCount, failedRowCount] = await Promise.all([
        tx.hubspotImportBatchRow.count({
          where: {
            batchId: input.importBatchId,
            status: PrismaHubspotImportBatchRowStatus.PREPARED,
          },
        }),
        tx.hubspotImportBatchRow.count({
          where: {
            batchId: input.importBatchId,
            status: PrismaHubspotImportBatchRowStatus.FAILED,
          },
        }),
      ]);

      if (preparedRowCount === 0) {
        throw new ServiceError(
          "HUBSPOT_IMPORT_EMPTY_PREPARED",
          500,
          "HubSpot import batch did not produce any CSV rows",
        );
      }

      const completed = await tx.hubspotImportBatch.updateMany({
        where: {
          id: input.importBatchId,
          status: PrismaHubspotImportBatchStatus.RUNNING,
          phaseLeaseOwner: lease.owner,
        },
        data: {
          status: PrismaHubspotImportBatchStatus.COMPLETED,
          preparedRowCount,
          failedRowCount,
          csvContent: buildCsvContent(csvRows),
          phaseLeaseOwner: null,
          phaseLeaseExpiresAt: null,
          completedAt: new Date(),
          lastError: null,
        },
      });
      if (completed.count !== 1) {
        throw csvFallbackLeaseLostError();
      }

      await tx.auditEvent.create({
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
    });
  } catch (error) {
    if (isCsvFallbackLeaseLost(error)) {
      return;
    }
    const lastError = formatErrorMessage(error);
    try {
      await withCsvFallbackLease(input.importBatchId, lease, async (tx) => {
        const [preparedRowCount, failedRowCount] = await Promise.all([
          tx.hubspotImportBatchRow.count({
            where: {
              batchId: input.importBatchId,
              status: PrismaHubspotImportBatchRowStatus.PREPARED,
            },
          }),
          tx.hubspotImportBatchRow.count({
            where: {
              batchId: input.importBatchId,
              status: PrismaHubspotImportBatchRowStatus.FAILED,
            },
          }),
        ]);
        const failed = await tx.hubspotImportBatch.updateMany({
          where: {
            id: input.importBatchId,
            status: PrismaHubspotImportBatchStatus.RUNNING,
            phaseLeaseOwner: lease.owner,
          },
          data: {
            status: PrismaHubspotImportBatchStatus.FAILED,
            preparedRowCount,
            failedRowCount,
            phaseLeaseOwner: null,
            phaseLeaseExpiresAt: null,
            completedAt: new Date(),
            lastError,
          },
        });
        if (failed.count !== 1) {
          throw csvFallbackLeaseLostError();
        }

        await tx.auditEvent.create({
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
      });
    } catch (failurePersistenceError) {
      if (isCsvFallbackLeaseLost(failurePersistenceError)) {
        return;
      }
      throw failurePersistenceError;
    }

    throw error;
  }
}
