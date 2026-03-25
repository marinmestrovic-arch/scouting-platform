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
import { upsertHubspotContact } from "@scouting-platform/integrations";

import { recordAuditEvent } from "../audit";
import { ServiceError } from "../errors";
import { enqueueHubspotPushJob } from "./queue";

export { stopHubspotPushQueue } from "./queue";

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
      summary: true,
      topics: true,
      brandFitNotes: true,
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
  return {
    email: channel.contacts[0]?.email ?? "",
    channel_id: channel.id,
    youtube_channel_id: channel.youtubeChannelId,
    youtube_channel_url: `https://www.youtube.com/channel/${channel.youtubeChannelId}`,
    creator_title: channel.title,
    creator_handle: channel.handle ?? "",
    subscriber_count: channel.metrics?.subscriberCount?.toString() ?? "",
    view_count: channel.metrics?.viewCount?.toString() ?? "",
    video_count: channel.metrics?.videoCount?.toString() ?? "",
    enrichment_summary: channel.enrichment?.summary ?? "",
    enrichment_topics: Array.isArray(channel.enrichment?.topics)
      ? channel.enrichment.topics
          .filter((topic): topic is string => typeof topic === "string" && topic.trim().length > 0)
          .join(";")
      : "",
    brand_fit_notes: channel.enrichment?.brandFitNotes ?? "",
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

  await enqueueHubspotPushJob({
    pushBatchId,
    requestedByUserId: input.requestedByUserId,
  });

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

function toHubspotFailureMessage(error: unknown): string {
  return formatErrorMessage(error);
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
        },
      },
    },
  });

  if (!batch || batch.requestedByUserId !== input.requestedByUserId) {
    throw new ServiceError("HUBSPOT_PUSH_BATCH_NOT_FOUND", 404, "HubSpot push batch not found");
  }

  if (
    batch.status === PrismaHubspotPushBatchStatus.RUNNING ||
    batch.status === PrismaHubspotPushBatchStatus.COMPLETED
  ) {
    return getHubspotPushBatchById({
      pushBatchId: input.pushBatchId,
      requestedByUserId: input.requestedByUserId,
    });
  }

  const scope = toScope(batch.scopePayload);

  const claimed = await prisma.hubspotPushBatch.updateMany({
    where: {
      id: batch.id,
      status: {
        in: [PrismaHubspotPushBatchStatus.QUEUED, PrismaHubspotPushBatchStatus.FAILED],
      },
    },
    data: {
      status: PrismaHubspotPushBatchStatus.RUNNING,
      startedAt: new Date(),
      completedAt: null,
      lastError: null,
      pushedRowCount: 0,
      failedRowCount: 0,
    },
  });

  if (claimed.count === 0) {
    return getHubspotPushBatchById({
      pushBatchId: input.pushBatchId,
      requestedByUserId: input.requestedByUserId,
    });
  }

  await prisma.hubspotPushBatchRow.updateMany({
    where: {
      batchId: batch.id,
    },
    data: {
      status: PrismaHubspotPushBatchRowStatus.PENDING,
      hubspotObjectId: null,
      errorMessage: null,
    },
  });

  try {
    const channels = await prisma.channel.findMany({
      where: {
        id: {
          in: scope.channelIds,
        },
      },
      select: channelPushSelect,
    });
    const channelsById = new Map(channels.map((channel) => [channel.id, channel]));

    let pushedRowCount = 0;
    let failedRowCount = 0;

    for (const row of batch.rows) {
      const channel = channelsById.get(row.channelId);
      const contactEmail = channel?.contacts[0]?.email ?? null;

      if (!channel) {
        failedRowCount += 1;
        await prisma.hubspotPushBatchRow.update({
          where: {
            id: row.id,
          },
          data: {
            contactEmail: null,
            status: PrismaHubspotPushBatchRowStatus.FAILED,
            errorMessage: "Channel no longer exists",
          },
        });
        continue;
      }

      if (!contactEmail) {
        failedRowCount += 1;
        await prisma.hubspotPushBatchRow.update({
          where: {
            id: row.id,
          },
          data: {
            contactEmail: null,
            status: PrismaHubspotPushBatchRowStatus.FAILED,
            errorMessage: "Channel has no contact email",
          },
        });
        continue;
      }

      try {
        const result = await upsertHubspotContact({
          email: contactEmail,
          properties: buildHubspotContactProperties(channel),
        });

        pushedRowCount += 1;
        await prisma.hubspotPushBatchRow.update({
          where: {
            id: row.id,
          },
          data: {
            contactEmail,
            status: PrismaHubspotPushBatchRowStatus.PUSHED,
            hubspotObjectId: result.id,
            errorMessage: null,
          },
        });
      } catch (error) {
        const message = toHubspotFailureMessage(error);
        failedRowCount += 1;
        await prisma.hubspotPushBatchRow.update({
          where: {
            id: row.id,
          },
          data: {
            contactEmail,
            status: PrismaHubspotPushBatchRowStatus.FAILED,
            errorMessage: message,
          },
        });
      }
    }

    await prisma.hubspotPushBatch.update({
      where: {
        id: batch.id,
      },
      data: {
        status: PrismaHubspotPushBatchStatus.COMPLETED,
        pushedRowCount,
        failedRowCount,
        completedAt: new Date(),
        lastError: null,
      },
    });

    await recordBatchCompletedAudit({
      pushBatchId: batch.id,
      actorUserId: input.requestedByUserId,
      totalRowCount: batch.totalRowCount,
      pushedRowCount,
      failedRowCount,
    });
  } catch (error) {
    const message = formatErrorMessage(error);
    const counts = await prisma.hubspotPushBatchRow.groupBy({
      by: ["status"],
      where: {
        batchId: batch.id,
      },
      _count: {
        _all: true,
      },
    });
    const pushedRowCount =
      counts.find((entry) => entry.status === PrismaHubspotPushBatchRowStatus.PUSHED)?._count._all ?? 0;
    const failedRowCount =
      counts.find((entry) => entry.status === PrismaHubspotPushBatchRowStatus.FAILED)?._count._all ?? 0;

    await prisma.hubspotPushBatch.update({
      where: {
        id: batch.id,
      },
      data: {
        status: PrismaHubspotPushBatchStatus.FAILED,
        pushedRowCount,
        failedRowCount,
        completedAt: new Date(),
        lastError: message,
      },
    });

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
