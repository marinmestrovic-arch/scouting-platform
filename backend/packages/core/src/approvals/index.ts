import {
  AdvancedReportRequestStatus as PrismaAdvancedReportRequestStatus,
  ChannelInsightSource as PrismaChannelInsightSource,
  ChannelProviderPayloadProvider,
  Prisma,
} from "@prisma/client";
import type {
  AdvancedReportRequestStatus,
  AdminAdvancedReportRequestDetail,
  AdminAdvancedReportRequestSummary,
  ChannelInsights,
  LatestCompletedAdvancedReport,
  RequestAdvancedReportResponse,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import {
  deriveHypeAuditorChannelInsightsFromRawPayload,
  fetchHypeAuditorChannelInsights,
  type HypeAuditorChannelInsights,
  isHypeAuditorError,
} from "@scouting-platform/integrations";

import { getChannelById } from "../channels";
import { ServiceError } from "../errors";
import { logProviderSpend } from "../telemetry";
import { enqueueAdvancedReportJob } from "./queue";
import {
  fromAdvancedReportRequestStatus,
  toLatestCompletedAdvancedReport,
  toAdvancedReportRequestStatus,
} from "./status";

type AdvancedReportDecisionInput = {
  advancedReportRequestId: string;
  actorUserId: string;
  decisionNote?: string;
};

const activeAdvancedReportStatuses = new Set<PrismaAdvancedReportRequestStatus>([
  PrismaAdvancedReportRequestStatus.PENDING_APPROVAL,
  PrismaAdvancedReportRequestStatus.APPROVED,
  PrismaAdvancedReportRequestStatus.QUEUED,
  PrismaAdvancedReportRequestStatus.RUNNING,
]);

const requestDedupeSelect = {
  id: true,
  status: true,
  completedAt: true,
} as const;

const latestCompletedAdminAdvancedReportSelect = {
  id: true,
  channelId: true,
  completedAt: true,
} as const;

const adminAdvancedReportRequestSelect = {
  id: true,
  status: true,
  decisionNote: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
  startedAt: true,
  completedAt: true,
  channel: {
    select: {
      id: true,
      youtubeChannelId: true,
      title: true,
    },
  },
  requestedByUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  reviewedByUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  providerPayload: {
    select: {
      payload: true,
    },
  },
} as const;

const insightSourcePrecedence = new Map<PrismaChannelInsightSource, number>([
  [PrismaChannelInsightSource.ADMIN_MANUAL, 1],
  [PrismaChannelInsightSource.CSV_IMPORT, 2],
  [PrismaChannelInsightSource.HYPEAUDITOR, 3],
]);

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeDecisionNote(decisionNote: string | undefined): string | null {
  const trimmed = decisionNote?.trim();
  return trimmed ? trimmed : null;
}

function shouldReuseRequest(request: {
  status: PrismaAdvancedReportRequestStatus;
  completedAt: Date | null;
} | null): boolean {
  if (!request) {
    return false;
  }

  if (activeAdvancedReportStatuses.has(request.status)) {
    return true;
  }

  return false;
}

function canApplyInsightSource(
  existingSource: PrismaChannelInsightSource | null | undefined,
  incomingSource: PrismaChannelInsightSource,
): boolean {
  if (!existingSource) {
    return true;
  }

  const existingRank = insightSourcePrecedence.get(existingSource);
  const incomingRank = insightSourcePrecedence.get(incomingSource);

  if (!existingRank || !incomingRank) {
    return false;
  }

  return incomingRank <= existingRank;
}

function deriveInsightsFromRawPayload(rawPayload: Prisma.JsonValue): HypeAuditorChannelInsights {
  try {
    return deriveHypeAuditorChannelInsightsFromRawPayload(rawPayload);
  } catch {
    throw new ServiceError(
      "HYPEAUDITOR_INVALID_STORED_PAYLOAD",
      500,
      "Stored HypeAuditor payload is invalid",
    );
  }
}

function toAdminAdvancedReportRequestSummary(
  request: Prisma.AdvancedReportRequestGetPayload<{
    select: typeof adminAdvancedReportRequestSelect;
  }>,
  lastCompletedReport: LatestCompletedAdvancedReport | null,
): AdminAdvancedReportRequestSummary {
  return {
    id: request.id,
    channel: {
      id: request.channel.id,
      youtubeChannelId: request.channel.youtubeChannelId,
      title: request.channel.title,
    },
    requestedBy: {
      id: request.requestedByUser.id,
      email: request.requestedByUser.email,
      name: request.requestedByUser.name,
    },
    reviewedBy: request.reviewedByUser
      ? {
          id: request.reviewedByUser.id,
          email: request.reviewedByUser.email,
          name: request.reviewedByUser.name,
        }
      : null,
    status: toAdvancedReportRequestStatus(request.status),
    decisionNote: request.decisionNote,
    lastError: request.lastError,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    startedAt: request.startedAt?.toISOString() ?? null,
    completedAt: request.completedAt?.toISOString() ?? null,
    lastCompletedReport,
  };
}

async function toAdminAdvancedReportRequestDetail(
  request: Prisma.AdvancedReportRequestGetPayload<{
    select: typeof adminAdvancedReportRequestSelect;
  }>,
  lastCompletedReport: LatestCompletedAdvancedReport | null,
): Promise<AdminAdvancedReportRequestDetail> {
  const channel = await getChannelById(request.channel.id);
  const insights: ChannelInsights = channel?.insights ?? {
    audienceCountries: [],
    audienceGenderAge: [],
    audienceInterests: [],
    estimatedPrice: null,
    brandMentions: [],
  };

  return {
    ...toAdminAdvancedReportRequestSummary(request, lastCompletedReport),
    insights,
    rawPayload: request.providerPayload?.payload ?? null,
  };
}

async function getAdvancedReportRequestRecord(
  advancedReportRequestId: string,
): Promise<
  Prisma.AdvancedReportRequestGetPayload<{
    select: typeof adminAdvancedReportRequestSelect;
  }> | null
> {
  return prisma.advancedReportRequest.findUnique({
    where: {
      id: advancedReportRequestId,
    },
    select: adminAdvancedReportRequestSelect,
  });
}

async function getLatestChannelAdvancedReportRequest(channelId: string) {
  return prisma.advancedReportRequest.findFirst({
    where: {
      channelId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: requestDedupeSelect,
  });
}

async function getLatestCompletedAdvancedReportsByChannelIds(
  channelIds: string[],
): Promise<Map<string, LatestCompletedAdvancedReport>> {
  if (channelIds.length === 0) {
    return new Map();
  }

  const requests = await prisma.advancedReportRequest.findMany({
    where: {
      channelId: {
        in: channelIds,
      },
      status: PrismaAdvancedReportRequestStatus.COMPLETED,
      completedAt: {
        not: null,
      },
    },
    orderBy: [
      {
        completedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    select: latestCompletedAdminAdvancedReportSelect,
  });

  const latestByChannelId = new Map<string, LatestCompletedAdvancedReport>();

  for (const request of requests) {
    if (latestByChannelId.has(request.channelId) || !request.completedAt) {
      continue;
    }

    const latestCompletedReport = toLatestCompletedAdvancedReport({
      request,
    });

    if (latestCompletedReport) {
      latestByChannelId.set(request.channelId, latestCompletedReport);
    }
  }

  return latestByChannelId;
}

export async function requestAdvancedReport(input: {
  channelId: string;
  requestedByUserId: string;
}): Promise<RequestAdvancedReportResponse> {
  const existingChannel = await prisma.channel.findUnique({
    where: {
      id: input.channelId,
    },
    select: {
      id: true,
    },
  });

  if (!existingChannel) {
    throw new ServiceError("CHANNEL_NOT_FOUND", 404, "Channel not found");
  }

  const latestRequest = await getLatestChannelAdvancedReportRequest(input.channelId);
  let requestId = latestRequest?.id ?? null;
  let created = false;

  if (!shouldReuseRequest(latestRequest)) {
    const createdRequest = await prisma.advancedReportRequest.create({
      data: {
        channelId: input.channelId,
        requestedByUserId: input.requestedByUserId,
        status: PrismaAdvancedReportRequestStatus.PENDING_APPROVAL,
      },
      select: {
        id: true,
      },
    });

    requestId = createdRequest.id;
    created = true;
  }

  if (!requestId) {
    throw new ServiceError("ADVANCED_REPORT_REQUEST_MISSING", 500, "Advanced report request missing");
  }

  await prisma.auditEvent.create({
    data: {
      actorUserId: input.requestedByUserId,
      action: "advanced_report.requested",
      entityType: "advanced_report_request",
      entityId: requestId,
      metadata: {
        channelId: input.channelId,
        created,
        reusedStatus:
          latestRequest && !created
            ? toAdvancedReportRequestStatus(latestRequest.status)
            : null,
      },
    },
  });

  const channel = await getChannelById(input.channelId);

  if (!channel) {
    throw new ServiceError("CHANNEL_NOT_FOUND", 404, "Channel not found");
  }

  return {
    channelId: input.channelId,
    advancedReport: channel.advancedReport,
  };
}

export async function listAdminAdvancedReportRequests(input?: {
  status?: AdvancedReportRequestStatus;
}): Promise<AdminAdvancedReportRequestSummary[]> {
  const status = input?.status
    ? fromAdvancedReportRequestStatus(input.status)
    : PrismaAdvancedReportRequestStatus.PENDING_APPROVAL;
  const items = await prisma.advancedReportRequest.findMany({
    where: {
      status,
    },
    orderBy:
      status === PrismaAdvancedReportRequestStatus.PENDING_APPROVAL
        ? {
            createdAt: "asc",
          }
        : {
            createdAt: "desc",
          },
    select: adminAdvancedReportRequestSelect,
  });

  const latestCompletedReportsByChannelId = await getLatestCompletedAdvancedReportsByChannelIds(
    [...new Set(items.map((item) => item.channel.id))],
  );

  return items.map((item) =>
    toAdminAdvancedReportRequestSummary(
      item,
      latestCompletedReportsByChannelId.get(item.channel.id) ?? null,
    ),
  );
}

export async function getAdminAdvancedReportRequestById(
  advancedReportRequestId: string,
): Promise<AdminAdvancedReportRequestDetail | null> {
  const request = await getAdvancedReportRequestRecord(advancedReportRequestId);

  if (!request) {
    return null;
  }

  const latestCompletedReportsByChannelId = await getLatestCompletedAdvancedReportsByChannelIds([
    request.channel.id,
  ]);

  return toAdminAdvancedReportRequestDetail(
    request,
    latestCompletedReportsByChannelId.get(request.channel.id) ?? null,
  );
}

export async function approveAdvancedReportRequest(
  input: AdvancedReportDecisionInput,
): Promise<AdminAdvancedReportRequestDetail> {
  const reviewedAt = new Date();
  const decisionNote = normalizeDecisionNote(input.decisionNote);

  await withDbTransaction(async (tx) => {
    const request = await tx.advancedReportRequest.findUnique({
      where: {
        id: input.advancedReportRequestId,
      },
      select: {
        id: true,
        status: true,
        channelId: true,
        requestedByUserId: true,
      },
    });

    if (!request) {
      throw new ServiceError(
        "ADVANCED_REPORT_REQUEST_NOT_FOUND",
        404,
        "Advanced report request not found",
      );
    }

    if (request.status !== PrismaAdvancedReportRequestStatus.PENDING_APPROVAL) {
      throw new ServiceError(
        "ADVANCED_REPORT_REQUEST_INVALID_STATE",
        409,
        "Only pending approval requests can be approved",
      );
    }

    await tx.advancedReportRequest.update({
      where: {
        id: input.advancedReportRequestId,
      },
      data: {
        status: PrismaAdvancedReportRequestStatus.APPROVED,
        reviewedByUserId: input.actorUserId,
        reviewedAt,
        decisionNote,
        lastError: null,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "advanced_report.approved",
        entityType: "advanced_report_request",
        entityId: request.id,
        metadata: {
          channelId: request.channelId,
          requestedByUserId: request.requestedByUserId,
          decisionNote,
        },
      },
    });
  });

  const approvedRequest = await prisma.advancedReportRequest.findUnique({
    where: {
      id: input.advancedReportRequestId,
    },
    select: {
      requestedByUserId: true,
    },
  });

  if (!approvedRequest) {
    throw new ServiceError(
      "ADVANCED_REPORT_REQUEST_NOT_FOUND",
      404,
      "Advanced report request not found",
    );
  }

  try {
    await enqueueAdvancedReportJob({
      advancedReportRequestId: input.advancedReportRequestId,
      requestedByUserId: approvedRequest.requestedByUserId,
    });

    await prisma.advancedReportRequest.update({
      where: {
        id: input.advancedReportRequestId,
      },
      data: {
        status: PrismaAdvancedReportRequestStatus.QUEUED,
        lastError: null,
      },
    });
  } catch (error) {
    await prisma.advancedReportRequest.updateMany({
      where: {
        id: input.advancedReportRequestId,
      },
      data: {
        status: PrismaAdvancedReportRequestStatus.FAILED,
        lastError: formatErrorMessage(error),
      },
    });

    throw new ServiceError(
      "ADVANCED_REPORT_ENQUEUE_FAILED",
      500,
      "Failed to enqueue advanced report job",
    );
  }

  const detail = await getAdminAdvancedReportRequestById(input.advancedReportRequestId);

  if (!detail) {
    throw new ServiceError(
      "ADVANCED_REPORT_REQUEST_NOT_FOUND",
      404,
      "Advanced report request not found",
    );
  }

  return detail;
}

export async function rejectAdvancedReportRequest(
  input: AdvancedReportDecisionInput,
): Promise<AdminAdvancedReportRequestDetail> {
  const reviewedAt = new Date();
  const decisionNote = normalizeDecisionNote(input.decisionNote);

  await withDbTransaction(async (tx) => {
    const request = await tx.advancedReportRequest.findUnique({
      where: {
        id: input.advancedReportRequestId,
      },
      select: {
        id: true,
        status: true,
        channelId: true,
        requestedByUserId: true,
      },
    });

    if (!request) {
      throw new ServiceError(
        "ADVANCED_REPORT_REQUEST_NOT_FOUND",
        404,
        "Advanced report request not found",
      );
    }

    if (request.status !== PrismaAdvancedReportRequestStatus.PENDING_APPROVAL) {
      throw new ServiceError(
        "ADVANCED_REPORT_REQUEST_INVALID_STATE",
        409,
        "Only pending approval requests can be rejected",
      );
    }

    await tx.advancedReportRequest.update({
      where: {
        id: input.advancedReportRequestId,
      },
      data: {
        status: PrismaAdvancedReportRequestStatus.REJECTED,
        reviewedByUserId: input.actorUserId,
        reviewedAt,
        decisionNote,
        lastError: null,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "advanced_report.rejected",
        entityType: "advanced_report_request",
        entityId: request.id,
        metadata: {
          channelId: request.channelId,
          requestedByUserId: request.requestedByUserId,
          decisionNote,
        },
      },
    });
  });

  const detail = await getAdminAdvancedReportRequestById(input.advancedReportRequestId);

  if (!detail) {
    throw new ServiceError(
      "ADVANCED_REPORT_REQUEST_NOT_FOUND",
      404,
      "Advanced report request not found",
    );
  }

  return detail;
}

export async function executeAdvancedReportRequest(input: {
  advancedReportRequestId: string;
  requestedByUserId: string;
}): Promise<void> {
  const request = await prisma.advancedReportRequest.findUnique({
    where: {
      id: input.advancedReportRequestId,
    },
    select: {
      id: true,
      requestedByUserId: true,
      status: true,
    },
  });

  if (!request) {
    return;
  }

  if (request.requestedByUserId !== input.requestedByUserId) {
    await prisma.advancedReportRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: PrismaAdvancedReportRequestStatus.FAILED,
        lastError: "Advanced report payload user mismatch",
      },
    });

    return;
  }

  const claimed = await prisma.advancedReportRequest.updateMany({
    where: {
      id: input.advancedReportRequestId,
      status: {
        in: [
          PrismaAdvancedReportRequestStatus.QUEUED,
          PrismaAdvancedReportRequestStatus.FAILED,
        ],
      },
    },
    data: {
      status: PrismaAdvancedReportRequestStatus.RUNNING,
      startedAt: new Date(),
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  try {
    const executionState = await prisma.advancedReportRequest.findUnique({
      where: {
        id: input.advancedReportRequestId,
      },
      select: {
        id: true,
        channelId: true,
        providerPayloadId: true,
        providerFetchedAt: true,
        lastProviderAttemptAt: true,
        nextProviderAttemptAt: true,
        channel: {
          select: {
            id: true,
            youtubeChannelId: true,
            insights: {
              select: {
                channelId: true,
                audienceCountriesSource: true,
                audienceGenderAgeSource: true,
                audienceInterestsSource: true,
                estimatedPriceSource: true,
                brandMentionsSource: true,
              },
            },
          },
        },
      },
    });

    if (!executionState) {
      return;
    }

    let providerPayloadId = executionState.providerPayloadId;
    let resolvedInsights: HypeAuditorChannelInsights | null = null;

    if (providerPayloadId !== null) {
      logProviderSpend({
        provider: "hypeauditor",
        operation: "fetch_insights",
        outcome: "payload_reuse",
        retryAttempt: true,
        durationMs: 0,
      });
    } else {
      const now = new Date();

      if (
        executionState.nextProviderAttemptAt !== null &&
        executionState.nextProviderAttemptAt > now
      ) {
        logProviderSpend({
          provider: "hypeauditor",
          operation: "fetch_insights",
          outcome: "not_ready",
          retryAttempt: true,
          durationMs: 0,
        });
        await prisma.advancedReportRequest.update({
          where: {
            id: executionState.id,
          },
          data: {
            status: PrismaAdvancedReportRequestStatus.FAILED,
            lastError: "HypeAuditor cooldown active — retry after nextProviderAttemptAt",
          },
        });
        throw new ServiceError(
          "HYPEAUDITOR_COOLDOWN_ACTIVE",
          429,
          "HypeAuditor cooldown active",
        );
      }

      await prisma.advancedReportRequest.update({
        where: {
          id: executionState.id,
        },
        data: {
          lastProviderAttemptAt: now,
        },
      });

      const providerCallStartedAt = Date.now();
      const retryAttempt = executionState.lastProviderAttemptAt !== null;
      const result = await (async () => {
        try {
          return await fetchHypeAuditorChannelInsights({
            youtubeChannelId: executionState.channel.youtubeChannelId,
          });
        } catch (error) {
          const durationMs = Date.now() - providerCallStartedAt;

          if (isHypeAuditorError(error)) {
            const serviceError = new ServiceError(error.code, error.status, error.message);

            if (serviceError.code === "HYPEAUDITOR_REPORT_NOT_READY") {
              logProviderSpend({
                provider: "hypeauditor",
                operation: "fetch_insights",
                outcome: "not_ready",
                retryAttempt,
                durationMs,
              });
              await prisma.advancedReportRequest.update({
                where: {
                  id: executionState.id,
                },
                data: {
                  status: PrismaAdvancedReportRequestStatus.FAILED,
                  lastError: serviceError.message,
                  nextProviderAttemptAt: new Date(Date.now() + 5 * 60 * 1000),
                },
              });
            } else {
              logProviderSpend({
                provider: "hypeauditor",
                operation: "fetch_insights",
                outcome: "error",
                retryAttempt,
                durationMs,
              });
            }

            throw serviceError;
          }

          logProviderSpend({
            provider: "hypeauditor",
            operation: "fetch_insights",
            outcome: "error",
            retryAttempt,
            durationMs,
          });
          throw error;
        }
      })();

      logProviderSpend({
        provider: "hypeauditor",
        operation: "fetch_insights",
        outcome: "fresh_call",
        retryAttempt,
        durationMs: Date.now() - providerCallStartedAt,
      });

      const providerFetchedAt = new Date();
      const providerPayload = await prisma.channelProviderPayload.create({
        data: {
          channelId: executionState.channelId,
          provider: ChannelProviderPayloadProvider.HYPEAUDITOR,
          payload: toJsonValue(result.rawPayload),
          fetchedAt: providerFetchedAt,
        },
        select: {
          id: true,
        },
      });

      providerPayloadId = providerPayload.id;
      resolvedInsights = result.insights;

      await prisma.advancedReportRequest.update({
        where: {
          id: executionState.id,
        },
        data: {
          providerPayloadId,
          providerFetchedAt,
          nextProviderAttemptAt: null,
        },
      });
    }

    const insights =
      resolvedInsights ??
      deriveInsightsFromRawPayload(
        (
          await prisma.channelProviderPayload.findUniqueOrThrow({
            where: {
              id: providerPayloadId,
            },
            select: {
              payload: true,
            },
          })
        ).payload,
      );
    const completedAt = new Date();

    await prisma.$transaction(async (tx) => {
      const existingInsight = executionState.channel.insights;
      const insightUpdateData: Prisma.ChannelInsightUncheckedUpdateInput = {};
      const insightCreateData: Prisma.ChannelInsightUncheckedCreateInput = {
        channelId: executionState.channelId,
      };

      if (
        canApplyInsightSource(
          existingInsight?.audienceCountriesSource,
          PrismaChannelInsightSource.HYPEAUDITOR,
        )
      ) {
        insightUpdateData.audienceCountries = toJsonValue(insights.audienceCountries);
        insightUpdateData.audienceCountriesSource = PrismaChannelInsightSource.HYPEAUDITOR;
        insightUpdateData.audienceCountriesSourceUpdatedAt = completedAt;
        insightCreateData.audienceCountries = toJsonValue(insights.audienceCountries);
        insightCreateData.audienceCountriesSource = PrismaChannelInsightSource.HYPEAUDITOR;
        insightCreateData.audienceCountriesSourceUpdatedAt = completedAt;
      }

      if (
        canApplyInsightSource(
          existingInsight?.audienceGenderAgeSource,
          PrismaChannelInsightSource.HYPEAUDITOR,
        )
      ) {
        insightUpdateData.audienceGenderAge = toJsonValue(insights.audienceGenderAge);
        insightUpdateData.audienceGenderAgeSource = PrismaChannelInsightSource.HYPEAUDITOR;
        insightUpdateData.audienceGenderAgeSourceUpdatedAt = completedAt;
        insightCreateData.audienceGenderAge = toJsonValue(insights.audienceGenderAge);
        insightCreateData.audienceGenderAgeSource = PrismaChannelInsightSource.HYPEAUDITOR;
        insightCreateData.audienceGenderAgeSourceUpdatedAt = completedAt;
      }

      if (
        canApplyInsightSource(
          existingInsight?.audienceInterestsSource,
          PrismaChannelInsightSource.HYPEAUDITOR,
        )
      ) {
        insightUpdateData.audienceInterests = toJsonValue(insights.audienceInterests);
        insightUpdateData.audienceInterestsSource = PrismaChannelInsightSource.HYPEAUDITOR;
        insightUpdateData.audienceInterestsSourceUpdatedAt = completedAt;
        insightCreateData.audienceInterests = toJsonValue(insights.audienceInterests);
        insightCreateData.audienceInterestsSource = PrismaChannelInsightSource.HYPEAUDITOR;
        insightCreateData.audienceInterestsSourceUpdatedAt = completedAt;
      }

      if (
        canApplyInsightSource(
          existingInsight?.estimatedPriceSource,
          PrismaChannelInsightSource.HYPEAUDITOR,
        )
      ) {
        insightUpdateData.estimatedPriceCurrencyCode = insights.estimatedPrice?.currencyCode ?? null;
        insightUpdateData.estimatedPriceMin = insights.estimatedPrice?.min ?? null;
        insightUpdateData.estimatedPriceMax = insights.estimatedPrice?.max ?? null;
        insightUpdateData.estimatedPriceSource = PrismaChannelInsightSource.HYPEAUDITOR;
        insightUpdateData.estimatedPriceSourceUpdatedAt = completedAt;
        insightCreateData.estimatedPriceCurrencyCode = insights.estimatedPrice?.currencyCode ?? null;
        insightCreateData.estimatedPriceMin = insights.estimatedPrice?.min ?? null;
        insightCreateData.estimatedPriceMax = insights.estimatedPrice?.max ?? null;
        insightCreateData.estimatedPriceSource = PrismaChannelInsightSource.HYPEAUDITOR;
        insightCreateData.estimatedPriceSourceUpdatedAt = completedAt;
      }

      if (
        canApplyInsightSource(
          existingInsight?.brandMentionsSource,
          PrismaChannelInsightSource.HYPEAUDITOR,
        )
      ) {
        insightUpdateData.brandMentions = toJsonValue(insights.brandMentions);
        insightUpdateData.brandMentionsSource = PrismaChannelInsightSource.HYPEAUDITOR;
        insightUpdateData.brandMentionsSourceUpdatedAt = completedAt;
        insightCreateData.brandMentions = toJsonValue(insights.brandMentions);
        insightCreateData.brandMentionsSource = PrismaChannelInsightSource.HYPEAUDITOR;
        insightCreateData.brandMentionsSourceUpdatedAt = completedAt;
      }

      await tx.channelInsight.upsert({
        where: {
          channelId: executionState.channelId,
        },
        create: insightCreateData,
        update: insightUpdateData,
      });

      await tx.advancedReportRequest.update({
        where: {
          id: executionState.id,
        },
        data: {
          status: PrismaAdvancedReportRequestStatus.COMPLETED,
          completedAt,
          lastError: null,
        },
      });
    });
  } catch (error) {
    const alreadyHandled =
      error instanceof ServiceError &&
      (error.code === "HYPEAUDITOR_REPORT_NOT_READY" ||
        error.code === "HYPEAUDITOR_COOLDOWN_ACTIVE");

    if (!alreadyHandled) {
      await prisma.advancedReportRequest.update({
        where: {
          id: input.advancedReportRequestId,
        },
        data: {
          status: PrismaAdvancedReportRequestStatus.FAILED,
          lastError: formatErrorMessage(error),
        },
      });
    }

    throw error;
  }
}

export * from "./queue";
export * from "./status";
