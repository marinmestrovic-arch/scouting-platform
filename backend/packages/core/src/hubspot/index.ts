import {
  HubspotPushBatchRowStatus as PrismaHubspotPushBatchRowStatus,
  HubspotPushBatchStatus as PrismaHubspotPushBatchStatus,
  type Prisma,
} from "@prisma/client";
import type {
  CreateHubspotPushBatchRequest,
  HubspotPushBatchDetail,
  HubspotPushBatchRow,
  HubspotPushBatchRowStatus,
  HubspotPushBatchScope,
  HubspotPushBatchStatus,
  HubspotPushBatchSummary,
} from "@scouting-platform/contracts";
import { createHubspotPushBatchRequestSchema } from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import {
  batchUpsertHubspotContacts,
  type HubspotBatchUpsertChunkCheckpoint,
  type HubspotBatchUpsertRecord,
} from "@scouting-platform/integrations";

import { recordAuditEvent } from "../audit";
import { ServiceError } from "../errors";
import { computeInfluencerSizeTier } from "./influencer-size";
import {
  inferVerticalsForHubspot,
  serializeHubspotMultiSelect,
} from "./vertical-inference";
import { enqueueHubspotPushJob } from "./queue";

export {
  stopHubspotHealthCheckQueue,
  stopHubspotObjectSyncQueue,
  stopHubspotPushQueue,
} from "./queue";
export * from "./preparation";

const HUBSPOT_PUSH_RUNNING_TIMEOUT_MS = 15 * 60 * 1_000;
const HUBSPOT_PUSH_LEASE_LOST = "HUBSPOT_PUSH_LEASE_LOST";

const batchActorSelect = {
  id: true,
  email: true,
  name: true,
} as const;

const batchSummarySelect = {
  id: true,
  status: true,
  totalRowCount: true,
  pushedRowCount: true,
  failedRowCount: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
  requestedByUser: {
    select: batchActorSelect,
  },
} as const;

const batchDetailSelect = {
  ...batchSummarySelect,
  scopePayload: true,
  rows: {
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      channelId: true,
      contactEmail: true,
      status: true,
      hubspotObjectId: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

const channelPushSelect = {
  id: true,
  youtubeChannelId: true,
  title: true,
  handle: true,
  youtubeUrl: true,
  contentLanguage: true,
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
      youtubeEngagementRate: true,
      youtubeFollowers: true,
    },
  },
  enrichment: {
    select: {
      summary: true,
      topics: true,
      brandFitNotes: true,
      structuredProfile: true,
    },
  },
  insights: {
    select: {
      audienceInterests: true,
    },
  },
} as const;

type BatchSummaryRecord = Prisma.HubspotPushBatchGetPayload<{
  select: typeof batchSummarySelect;
}>;

type BatchDetailRecord = Prisma.HubspotPushBatchGetPayload<{
  select: typeof batchDetailSelect;
}>;

type PushChannelRecord = Prisma.ChannelGetPayload<{
  select: typeof channelPushSelect;
}>;

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

function normalizeScope(input: CreateHubspotPushBatchRequest): HubspotPushBatchScope {
  const parsed = createHubspotPushBatchRequestSchema.parse(input);

  return {
    channelIds: uniquePreservingOrder(parsed.channelIds),
  };
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toHubspotPushBatchStatus(
  status: PrismaHubspotPushBatchStatus,
): HubspotPushBatchStatus {
  switch (status) {
    case PrismaHubspotPushBatchStatus.RUNNING:
      return "running";
    case PrismaHubspotPushBatchStatus.COMPLETED:
      return "completed";
    case PrismaHubspotPushBatchStatus.FAILED:
      return "failed";
    default:
      return "queued";
  }
}

function toHubspotPushBatchRowStatus(
  status: PrismaHubspotPushBatchRowStatus,
): HubspotPushBatchRowStatus {
  switch (status) {
    case PrismaHubspotPushBatchRowStatus.PUSHED:
      return "pushed";
    case PrismaHubspotPushBatchRowStatus.FAILED:
      return "failed";
    default:
      return "pending";
  }
}

function toScope(scopePayload: Prisma.JsonValue): HubspotPushBatchScope {
  if (!isJsonObject(scopePayload)) {
    throw new ServiceError("HUBSPOT_PUSH_SCOPE_INVALID", 500, "HubSpot push batch scope is invalid");
  }

  const parsed = createHubspotPushBatchRequestSchema.safeParse(scopePayload);

  if (!parsed.success) {
    throw new ServiceError("HUBSPOT_PUSH_SCOPE_INVALID", 500, "HubSpot push batch scope is invalid");
  }

  return normalizeScope(parsed.data);
}

function toRow(row: BatchDetailRecord["rows"][number]): HubspotPushBatchRow {
  return {
    id: row.id,
    channelId: row.channelId,
    contactEmail: row.contactEmail,
    status: toHubspotPushBatchRowStatus(row.status),
    hubspotObjectId: row.hubspotObjectId,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSummary(batch: BatchSummaryRecord): HubspotPushBatchSummary {
  return {
    id: batch.id,
    status: toHubspotPushBatchStatus(batch.status),
    totalRowCount: batch.totalRowCount,
    pushedRowCount: batch.pushedRowCount,
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

function toDetail(batch: BatchDetailRecord): HubspotPushBatchDetail {
  return {
    ...toSummary(batch),
    scope: toScope(batch.scopePayload),
    rows: batch.rows.map(toRow),
  };
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
      "HUBSPOT_PUSH_CHANNELS_INVALID",
      400,
      "One or more selected channels do not exist",
    );
  }
}

export function buildHubspotContactProperties(channel: PushChannelRecord): Record<string, string> {
  const subscriberCount = channel.metrics?.subscriberCount;
  const youtubeUrl = channel.youtubeUrl
    ?? `https://www.youtube.com/channel/${channel.youtubeChannelId}`;
  const youtubeHandle = channel.handle?.trim() || null;
  const youtubeFollowers =
    channel.metrics?.youtubeFollowers?.toString()
    ?? subscriberCount?.toString()
    ?? null;
  const youtubeEngagementRate = channel.metrics?.youtubeEngagementRate?.toString() ?? null;
  const language = channel.contentLanguage?.trim() || null;
  const inferredVerticals = inferVerticalsForHubspot({
    structuredProfile: channel.enrichment?.structuredProfile,
    topics: channel.enrichment?.topics,
    audienceInterests: channel.insights?.audienceInterests,
  });
  const influencerSize = computeInfluencerSizeTier(subscriberCount);
  const influencerVertical = serializeHubspotMultiSelect(inferredVerticals);

  return {
    email: channel.contacts[0]?.email ?? "",
    contact_type: "Influencer",
    platforms: "YouTube",
    youtube_url: youtubeUrl,
    ...(youtubeHandle ? { youtube_handle: youtubeHandle } : {}),
    influencer_url: youtubeUrl,
    ...(youtubeFollowers !== null ? { youtube_followers: youtubeFollowers } : {}),
    ...(youtubeEngagementRate !== null
      ? { youtube_engagement_rate: youtubeEngagementRate }
      : {}),
    ...(influencerSize ? { influencer_size: influencerSize } : {}),
    ...(language ? { language } : {}),
    ...(influencerVertical ? { influencer_vertical: influencerVertical } : {}),
  };
}

async function loadBatchSummary(input: {
  pushBatchId: string;
  requestedByUserId: string;
}): Promise<HubspotPushBatchSummary> {
  const batch = await prisma.hubspotPushBatch.findFirst({
    where: {
      id: input.pushBatchId,
      requestedByUserId: input.requestedByUserId,
    },
    select: batchSummarySelect,
  });

  if (!batch) {
    throw new ServiceError("HUBSPOT_PUSH_BATCH_NOT_FOUND", 404, "HubSpot push batch not found");
  }

  return toSummary(batch);
}

export async function createHubspotPushBatch(input: {
  requestedByUserId: string;
  channelIds: CreateHubspotPushBatchRequest["channelIds"];
}): Promise<HubspotPushBatchSummary> {
  const scope = normalizeScope({ channelIds: input.channelIds });
  await validateSelectedChannelIds(scope.channelIds);

  let pushBatchId = "";

  await withDbTransaction(async (tx) => {
    const batch = await tx.hubspotPushBatch.create({
      data: {
        requestedByUserId: input.requestedByUserId,
        scopePayload: toJsonValue(scope),
        totalRowCount: scope.channelIds.length,
        rows: {
          create: scope.channelIds.map((channelId) => ({
            channelId,
          })),
        },
      },
      select: {
        id: true,
      },
    });

    pushBatchId = batch.id;

    await tx.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "hubspot_push.requested",
        entityType: "hubspot_push_batch",
        entityId: batch.id,
        metadata: toJsonValue({
          totalRowCount: scope.channelIds.length,
        }),
      },
    });
  });

  try {
    await enqueueHubspotPushJob({
      pushBatchId,
      requestedByUserId: input.requestedByUserId,
    });
  } catch (error) {
    const completedAt = new Date();
    const lastError = `HubSpot push queue unavailable: ${formatErrorMessage(error)}`.slice(0, 2_000);
    await withDbTransaction(async (tx) => {
      const failed = await tx.hubspotPushBatch.updateMany({
        where: {
          id: pushBatchId,
          requestedByUserId: input.requestedByUserId,
          status: PrismaHubspotPushBatchStatus.QUEUED,
        },
        data: {
          status: PrismaHubspotPushBatchStatus.FAILED,
          completedAt,
          lastError,
        },
      });
      if (failed.count === 0) {
        return;
      }
      await tx.auditEvent.create({
        data: {
          actorUserId: input.requestedByUserId,
          action: "hubspot_push.enqueue_failed",
          entityType: "hubspot_push_batch",
          entityId: pushBatchId,
          metadata: { lastError },
        },
      });
    });
    throw error;
  }

  return loadBatchSummary({
    pushBatchId,
    requestedByUserId: input.requestedByUserId,
  });
}

export async function listHubspotPushBatches(input: {
  requestedByUserId: string;
}): Promise<HubspotPushBatchSummary[]> {
  const batches = await prisma.hubspotPushBatch.findMany({
    where: {
      requestedByUserId: input.requestedByUserId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: batchSummarySelect,
  });

  return batches.map(toSummary);
}

export async function getHubspotPushBatchById(input: {
  pushBatchId: string;
  requestedByUserId: string;
}): Promise<HubspotPushBatchDetail> {
  const batch = await prisma.hubspotPushBatch.findFirst({
    where: {
      id: input.pushBatchId,
      requestedByUserId: input.requestedByUserId,
    },
    select: batchDetailSelect,
  });

  if (!batch) {
    throw new ServiceError("HUBSPOT_PUSH_BATCH_NOT_FOUND", 404, "HubSpot push batch not found");
  }

  return toDetail(batch);
}

type LegacyPushCandidate = Readonly<{
  rowId: string;
  contactEmail: string;
  record: HubspotBatchUpsertRecord & { objectWriteTraceId: string };
}>;

type LegacyPushExecution = Readonly<{
  startedAt: Date;
}>;

function legacyPushLeaseLostError(): ServiceError {
  return new ServiceError(
    HUBSPOT_PUSH_LEASE_LOST,
    409,
    "HubSpot push execution ownership was lost",
  );
}

function isLegacyPushLeaseLost(error: unknown): boolean {
  return error instanceof ServiceError && error.code === HUBSPOT_PUSH_LEASE_LOST;
}

async function withLegacyPushExecution<T>(
  pushBatchId: string,
  execution: LegacyPushExecution,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withDbTransaction(async (tx) => {
    const renewed = await tx.hubspotPushBatch.updateMany({
      where: {
        id: pushBatchId,
        status: PrismaHubspotPushBatchStatus.RUNNING,
        startedAt: execution.startedAt,
      },
      // Rewriting the execution token also advances the @updatedAt heartbeat.
      data: { startedAt: execution.startedAt },
    });
    if (renewed.count !== 1) {
      throw legacyPushLeaseLostError();
    }
    return callback(tx);
  });
}

async function renewLegacyPushExecution(
  pushBatchId: string,
  execution: LegacyPushExecution,
): Promise<void> {
  await withLegacyPushExecution(pushBatchId, execution, async () => undefined);
}

function legacyPushTraceId(rowId: string): string {
  return `legacy-hubspot-push-${rowId}`;
}

async function persistPushChunkCheckpoint(input: {
  pushBatchId: string;
  execution: LegacyPushExecution;
  candidates: readonly LegacyPushCandidate[];
  checkpoint: HubspotBatchUpsertChunkCheckpoint;
}): Promise<void> {
  await withLegacyPushExecution(input.pushBatchId, input.execution, async (tx) => {
    for (const outcome of input.checkpoint.outcomes) {
      const candidate = input.candidates[outcome.inputIndex];

      if (!candidate || candidate.record.objectWriteTraceId !== outcome.objectWriteTraceId) {
        throw new ServiceError(
          "HUBSPOT_PUSH_RESPONSE_INVALID",
          502,
          "HubSpot push response could not be mapped to its source row",
        );
      }

      await tx.hubspotPushBatchRow.updateMany({
        where: {
          id: candidate.rowId,
          batchId: input.pushBatchId,
          status: {
            not: PrismaHubspotPushBatchRowStatus.PUSHED,
          },
        },
        data: outcome.success
          ? {
              contactEmail: candidate.contactEmail,
              status: PrismaHubspotPushBatchRowStatus.PUSHED,
              hubspotObjectId: outcome.id,
              errorMessage: null,
            }
          : {
              contactEmail: candidate.contactEmail,
              status: PrismaHubspotPushBatchRowStatus.FAILED,
              hubspotObjectId: null,
              errorMessage: outcome.message,
            },
      });
    }

    const counts = await tx.hubspotPushBatchRow.groupBy({
      by: ["status"],
      where: {
        batchId: input.pushBatchId,
      },
      _count: {
        _all: true,
      },
    });
    const pushedRowCount =
      counts.find((entry) => entry.status === PrismaHubspotPushBatchRowStatus.PUSHED)
        ?._count._all ?? 0;
    const failedRowCount =
      counts.find((entry) => entry.status === PrismaHubspotPushBatchRowStatus.FAILED)
        ?._count._all ?? 0;

    await tx.hubspotPushBatch.updateMany({
      where: {
        id: input.pushBatchId,
        status: PrismaHubspotPushBatchStatus.RUNNING,
        startedAt: input.execution.startedAt,
      },
      data: {
        pushedRowCount,
        failedRowCount,
      },
    });
  });
}

async function loadPushRowCounts(pushBatchId: string): Promise<{
  pushedRowCount: number;
  failedRowCount: number;
}> {
  const counts = await prisma.hubspotPushBatchRow.groupBy({
    by: ["status"],
    where: {
      batchId: pushBatchId,
    },
    _count: {
      _all: true,
    },
  });

  return {
    pushedRowCount:
      counts.find((entry) => entry.status === PrismaHubspotPushBatchRowStatus.PUSHED)
        ?._count._all ?? 0,
    failedRowCount:
      counts.find((entry) => entry.status === PrismaHubspotPushBatchRowStatus.FAILED)
        ?._count._all ?? 0,
  };
}

async function recordBatchFailedAudit(input: {
  pushBatchId: string;
  actorUserId: string;
  totalRowCount: number;
  pushedRowCount: number;
  failedRowCount: number;
  lastError: string;
}): Promise<void> {
  await recordAuditEvent({
    actorUserId: input.actorUserId,
    action: "hubspot_push.failed",
    entityType: "hubspot_push_batch",
    entityId: input.pushBatchId,
    metadata: {
      totalRowCount: input.totalRowCount,
      pushedRowCount: input.pushedRowCount,
      failedRowCount: input.failedRowCount,
      lastError: input.lastError,
    },
  });
}

async function recordBatchCompletedAudit(input: {
  pushBatchId: string;
  actorUserId: string;
  totalRowCount: number;
  pushedRowCount: number;
  failedRowCount: number;
}): Promise<void> {
  await recordAuditEvent({
    actorUserId: input.actorUserId,
    action: "hubspot_push.completed",
    entityType: "hubspot_push_batch",
    entityId: input.pushBatchId,
    metadata: {
      totalRowCount: input.totalRowCount,
      pushedRowCount: input.pushedRowCount,
      failedRowCount: input.failedRowCount,
    },
  });
}

export async function executeHubspotPushBatch(input: {
  pushBatchId: string;
  requestedByUserId: string;
}): Promise<HubspotPushBatchDetail> {
  const batch = await prisma.hubspotPushBatch.findUnique({
    where: {
      id: input.pushBatchId,
    },
    select: {
      id: true,
      requestedByUserId: true,
      status: true,
      totalRowCount: true,
      scopePayload: true,
      rows: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          channelId: true,
          status: true,
        },
      },
    },
  });

  if (!batch || batch.requestedByUserId !== input.requestedByUserId) {
    throw new ServiceError("HUBSPOT_PUSH_BATCH_NOT_FOUND", 404, "HubSpot push batch not found");
  }

  if (batch.status === PrismaHubspotPushBatchStatus.COMPLETED) {
    return getHubspotPushBatchById({
      pushBatchId: input.pushBatchId,
      requestedByUserId: input.requestedByUserId,
    });
  }

  const scope = toScope(batch.scopePayload);
  const preservedPushedRowCount = batch.rows.filter(
    (row) => row.status === PrismaHubspotPushBatchRowStatus.PUSHED,
  ).length;
  const execution: LegacyPushExecution = { startedAt: new Date() };
  const staleRunningBefore = new Date(
    execution.startedAt.getTime() - HUBSPOT_PUSH_RUNNING_TIMEOUT_MS,
  );

  const claimed = await prisma.hubspotPushBatch.updateMany({
    where: {
      id: batch.id,
      OR: [
        {
          status: {
            in: [PrismaHubspotPushBatchStatus.QUEUED, PrismaHubspotPushBatchStatus.FAILED],
          },
        },
        {
          status: PrismaHubspotPushBatchStatus.RUNNING,
          updatedAt: { lte: staleRunningBefore },
        },
      ],
    },
    data: {
      status: PrismaHubspotPushBatchStatus.RUNNING,
      startedAt: execution.startedAt,
      completedAt: null,
      lastError: null,
      pushedRowCount: preservedPushedRowCount,
      failedRowCount: 0,
    },
  });

  if (claimed.count === 0) {
    return getHubspotPushBatchById({
      pushBatchId: input.pushBatchId,
      requestedByUserId: input.requestedByUserId,
    });
  }

  try {
    await withLegacyPushExecution(batch.id, execution, async (tx) => {
      await tx.hubspotPushBatchRow.updateMany({
        where: {
          batchId: batch.id,
          status: {
            not: PrismaHubspotPushBatchRowStatus.PUSHED,
          },
        },
        data: {
          status: PrismaHubspotPushBatchRowStatus.PENDING,
          hubspotObjectId: null,
          errorMessage: null,
        },
      });
    });

    const scopeOrder = new Map(scope.channelIds.map((channelId, index) => [channelId, index]));
    const retryRows = batch.rows
      .filter((row) => row.status !== PrismaHubspotPushBatchRowStatus.PUSHED)
      .sort((left, right) =>
        (scopeOrder.get(left.channelId) ?? Number.MAX_SAFE_INTEGER)
        - (scopeOrder.get(right.channelId) ?? Number.MAX_SAFE_INTEGER)
        || left.id.localeCompare(right.id),
      );
    const channels = await prisma.channel.findMany({
      where: {
        id: {
          in: retryRows.map((row) => row.channelId),
        },
      },
      select: channelPushSelect,
    });
    const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
    const candidates: LegacyPushCandidate[] = [];

    for (const row of retryRows) {
      const channel = channelsById.get(row.channelId);
      const contactEmail = channel?.contacts[0]?.email ?? null;

      if (!channel) {
        await withLegacyPushExecution(batch.id, execution, async (tx) => {
          await tx.hubspotPushBatchRow.update({
            where: {
              id: row.id,
            },
            data: {
              contactEmail: null,
              status: PrismaHubspotPushBatchRowStatus.FAILED,
              errorMessage: "Channel no longer exists",
            },
          });
        });
        continue;
      }

      if (!contactEmail) {
        await withLegacyPushExecution(batch.id, execution, async (tx) => {
          await tx.hubspotPushBatchRow.update({
            where: {
              id: row.id,
            },
            data: {
              contactEmail: null,
              status: PrismaHubspotPushBatchRowStatus.FAILED,
              errorMessage: "Channel has no contact email",
            },
          });
        });
        continue;
      }

      candidates.push({
        rowId: row.id,
        contactEmail,
        record: {
          id: contactEmail,
          idProperty: "email",
          properties: buildHubspotContactProperties(channel),
          objectWriteTraceId: legacyPushTraceId(row.id),
        },
      });
    }

    if (candidates.length > 0) {
      await renewLegacyPushExecution(batch.id, execution);
      await batchUpsertHubspotContacts({
        allowEmailIdentifierForFullUpsert: true,
        records: candidates.map((candidate) => candidate.record),
        onChunkComplete: async (checkpoint) => {
          await persistPushChunkCheckpoint({
            pushBatchId: batch.id,
            execution,
            candidates,
            checkpoint,
          });
        },
      });
    }

    const { pushedRowCount, failedRowCount } = await loadPushRowCounts(batch.id);

    const completed = await prisma.hubspotPushBatch.updateMany({
      where: {
        id: batch.id,
        status: PrismaHubspotPushBatchStatus.RUNNING,
        startedAt: execution.startedAt,
      },
      data: {
        status: PrismaHubspotPushBatchStatus.COMPLETED,
        pushedRowCount,
        failedRowCount,
        completedAt: new Date(),
        lastError: null,
      },
    });
    if (completed.count !== 1) {
      throw legacyPushLeaseLostError();
    }

    await recordBatchCompletedAudit({
      pushBatchId: batch.id,
      actorUserId: input.requestedByUserId,
      totalRowCount: batch.totalRowCount,
      pushedRowCount,
      failedRowCount,
    });
  } catch (error) {
    if (isLegacyPushLeaseLost(error)) {
      return getHubspotPushBatchById({
        pushBatchId: batch.id,
        requestedByUserId: input.requestedByUserId,
      });
    }
    const message = formatErrorMessage(error);
    const { pushedRowCount, failedRowCount } = await loadPushRowCounts(batch.id);

    const failed = await prisma.hubspotPushBatch.updateMany({
      where: {
        id: batch.id,
        status: PrismaHubspotPushBatchStatus.RUNNING,
        startedAt: execution.startedAt,
      },
      data: {
        status: PrismaHubspotPushBatchStatus.FAILED,
        pushedRowCount,
        failedRowCount,
        completedAt: new Date(),
        lastError: message,
      },
    });
    if (failed.count !== 1) {
      return getHubspotPushBatchById({
        pushBatchId: batch.id,
        requestedByUserId: input.requestedByUserId,
      });
    }

    await recordBatchFailedAudit({
      pushBatchId: batch.id,
      actorUserId: input.requestedByUserId,
      totalRowCount: batch.totalRowCount,
      pushedRowCount,
      failedRowCount,
      lastError: message,
    });

    throw error;
  }

  return getHubspotPushBatchById({
    pushBatchId: batch.id,
    requestedByUserId: input.requestedByUserId,
  });
}

export * from "./import-batches";
export * from "./object-sync";
export * from "./direct-sync-domain";
export * from "./direct-sync-service";
export * from "./delivery-recovery";
export * from "./conflicts";
export * from "./health";
export * from "./extension-context";
export * from "./provider-auth";
export * from "./reconciliation-domain";
export * from "./webhooks";
