import {
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
  CredentialProvider,
  Prisma,
} from "@prisma/client";
import type { RequestChannelEnrichmentResponse } from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import {
  extractOpenAiChannelEnrichmentProfileFromRawPayload,
  enrichChannelWithOpenAi,
  fetchYoutubeChannelContext,
  isOpenAiChannelEnrichmentError,
  type YoutubeChannelContext,
  isYoutubeChannelContextProviderError,
  youtubeChannelContextSchema,
} from "@scouting-platform/integrations";

import { getUserYoutubeApiKey } from "../auth";
import { getChannelById } from "../channels";
import { ServiceError } from "../errors";
import { enqueueJob } from "../queue";
import { logProviderSpend } from "../telemetry";
import { deriveYoutubeMetrics } from "./metrics";
import { isYoutubeContextFresh, resolveChannelEnrichmentStatus } from "./status";

type ChannelYoutubeContextCacheRow = {
  context: Prisma.JsonValue | null;
  fetchedAt: Date | null;
  lastError: string | null;
};

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toNullableBigInt(value: number | null): bigint | null {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return BigInt(Math.round(value));
}

function getCachedYoutubeContext(row: ChannelYoutubeContextCacheRow | null) {
  if (!row?.context) {
    return null;
  }

  const parsed = youtubeChannelContextSchema.safeParse(row.context);
  return parsed.success ? parsed.data : null;
}

function extractProfileFromRawPayload(
  raw: Prisma.JsonValue,
): { summary: string; topics: string[]; brandFitNotes: string; confidence: number } {
  try {
    return extractOpenAiChannelEnrichmentProfileFromRawPayload(raw);
  } catch {
    throw new ServiceError(
      "OPENAI_INVALID_STORED_PAYLOAD",
      500,
      "Stored OpenAI payload is invalid",
    );
  }
}

function extractTokenUsage(
  rawPayload: unknown,
): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
  if (!rawPayload || typeof rawPayload !== "object") {
    return undefined;
  }

  const usage = (rawPayload as Record<string, unknown>).usage;

  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const u = usage as Record<string, unknown>;
  const prompt = Number(u.prompt_tokens);
  const completion = Number(u.completion_tokens);
  const total = Number(u.total_tokens);

  if (!Number.isFinite(prompt)) {
    return undefined;
  }

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
  };
}

async function refreshYoutubeContext(input: {
  channelId: string;
  youtubeChannelId: string;
  youtubeApiKey: string;
  cachedContextRow: ChannelYoutubeContextCacheRow | null;
}) {
  const cachedContext = getCachedYoutubeContext(input.cachedContextRow);

  if (
    cachedContext &&
    isYoutubeContextFresh({
      fetchedAt: input.cachedContextRow?.fetchedAt,
    })
  ) {
    return cachedContext;
  }

  try {
    const context = await fetchYoutubeChannelContext({
      apiKey: input.youtubeApiKey,
      channelId: input.youtubeChannelId,
      maxVideos: 10,
    });
    const fetchedAt = new Date();

    await prisma.channelYoutubeContext.upsert({
      where: {
        channelId: input.channelId,
      },
      create: {
        channelId: input.channelId,
        context: toJsonValue(context),
        fetchedAt,
        lastError: null,
      },
      update: {
        context: toJsonValue(context),
        fetchedAt,
        lastError: null,
      },
    });

    return context;
  } catch (error) {
    const lastError = formatErrorMessage(error);

    await prisma.channelYoutubeContext.upsert({
      where: {
        channelId: input.channelId,
      },
      create: {
        channelId: input.channelId,
        context: input.cachedContextRow?.context
          ? (input.cachedContextRow.context as Prisma.InputJsonValue)
          : Prisma.DbNull,
        fetchedAt: input.cachedContextRow?.fetchedAt ?? null,
        lastError,
      },
      update: {
        lastError,
      },
    });

    throw error;
  }
}

export async function requestChannelLlmEnrichment(input: {
  channelId: string;
  requestedByUserId: string;
}): Promise<RequestChannelEnrichmentResponse> {
  const requestedAt = new Date();
  let shouldEnqueue = false;

  await withDbTransaction(async (tx) => {
    const channel = await tx.channel.findUnique({
      where: {
        id: input.channelId,
      },
      select: {
        updatedAt: true,
        enrichment: {
          select: {
            status: true,
            completedAt: true,
          },
        },
      },
    });

    if (!channel) {
      throw new ServiceError("CHANNEL_NOT_FOUND", 404, "Channel not found");
    }

    const hasYoutubeKey = await tx.userProviderCredential.findUnique({
      where: {
        userId_provider: {
          userId: input.requestedByUserId,
          provider: CredentialProvider.YOUTUBE_DATA_API,
        },
      },
      select: {
        id: true,
      },
    });

    if (!hasYoutubeKey) {
      throw new ServiceError(
        "YOUTUBE_KEY_REQUIRED",
        400,
        "Assigned YouTube API key is required before requesting enrichment",
      );
    }

    const previousStatus = resolveChannelEnrichmentStatus({
      channelUpdatedAt: channel.updatedAt,
      enrichment: channel.enrichment,
    });

    if (
      channel.enrichment?.status === PrismaChannelEnrichmentStatus.QUEUED ||
      channel.enrichment?.status === PrismaChannelEnrichmentStatus.RUNNING
    ) {
      shouldEnqueue = false;
    } else if (channel.enrichment) {
      shouldEnqueue = true;

      await tx.channelEnrichment.update({
        where: {
          channelId: input.channelId,
        },
        data: {
          status: PrismaChannelEnrichmentStatus.QUEUED,
          requestedByUserId: input.requestedByUserId,
          requestedAt,
          startedAt: null,
          lastError: null,
        },
      });
    } else {
      shouldEnqueue = true;

      await tx.channelEnrichment.create({
        data: {
          channelId: input.channelId,
          status: PrismaChannelEnrichmentStatus.QUEUED,
          requestedByUserId: input.requestedByUserId,
          requestedAt,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "channel.enrichment.requested",
        entityType: "channel",
        entityId: input.channelId,
        metadata: {
          previousStatus,
          queued: shouldEnqueue,
        },
      },
    });
  });

  if (shouldEnqueue) {
    try {
      await enqueueJob("channels.enrich.llm", {
        channelId: input.channelId,
        requestedByUserId: input.requestedByUserId,
      });
    } catch (error) {
      await prisma.channelEnrichment.update({
        where: {
          channelId: input.channelId,
        },
        data: {
          status: PrismaChannelEnrichmentStatus.FAILED,
          lastError: formatErrorMessage(error),
        },
      });

      throw new ServiceError(
        "CHANNEL_ENRICHMENT_ENQUEUE_FAILED",
        500,
        "Failed to enqueue channel enrichment job",
      );
    }
  }

  const channel = await getChannelById(input.channelId);

  if (!channel) {
    throw new ServiceError("CHANNEL_NOT_FOUND", 404, "Channel not found");
  }

  return {
    channelId: input.channelId,
    enrichment: channel.enrichment,
  };
}

export async function executeChannelLlmEnrichment(input: {
  channelId: string;
  requestedByUserId: string;
}): Promise<void> {
  const enrichment = await prisma.channelEnrichment.findUnique({
    where: {
      channelId: input.channelId,
    },
    select: {
      channelId: true,
      requestedByUserId: true,
    },
  });

  if (!enrichment) {
    return;
  }

  const claimed = await prisma.channelEnrichment.updateMany({
    where: {
      channelId: input.channelId,
      status: {
        in: [
          PrismaChannelEnrichmentStatus.QUEUED,
          PrismaChannelEnrichmentStatus.FAILED,
          PrismaChannelEnrichmentStatus.STALE,
        ],
      },
    },
    data: {
      status: PrismaChannelEnrichmentStatus.RUNNING,
      startedAt: new Date(),
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  try {
    const executionState = await prisma.channelEnrichment.findUnique({
      where: {
        channelId: input.channelId,
      },
      select: {
        channelId: true,
        requestedByUserId: true,
        rawOpenaiPayload: true,
        rawOpenaiPayloadFetchedAt: true,
        youtubeFetchedAt: true,
        channel: {
          select: {
            id: true,
            youtubeChannelId: true,
            title: true,
            handle: true,
            description: true,
            youtubeContext: {
              select: {
                context: true,
                fetchedAt: true,
                lastError: true,
              },
            },
          },
        },
      },
    });

    if (!executionState) {
      return;
    }

    const youtubeApiKey = await getUserYoutubeApiKey(executionState.requestedByUserId);

    if (!youtubeApiKey) {
      throw new ServiceError(
        "YOUTUBE_KEY_REQUIRED",
        400,
        "Assigned YouTube API key is required before executing enrichment",
      );
    }

    let youtubeContext: YoutubeChannelContext;
    const youtubeRetryAttempt = executionState.youtubeFetchedAt !== null;

    if (executionState.youtubeFetchedAt !== null) {
      const contextRow = await prisma.channelYoutubeContext.findUnique({
        where: {
          channelId: input.channelId,
        },
        select: {
          context: true,
          fetchedAt: true,
          lastError: true,
        },
      });
      const cachedContext = getCachedYoutubeContext(contextRow);

      if (!cachedContext) {
        throw new ServiceError(
          "YOUTUBE_CONTEXT_MISSING",
          500,
          "YouTube context missing after youtubeFetchedAt set",
        );
      }

      youtubeContext = cachedContext;
      logProviderSpend({
        provider: "youtube_context",
        operation: "refresh_context",
        outcome: "payload_reuse",
        retryAttempt: true,
        durationMs: 0,
      });
    } else {
      const youtubeContextStartedAt = Date.now();
      youtubeContext = await (async () => {
        try {
          return await refreshYoutubeContext({
            channelId: executionState.channel.id,
            youtubeChannelId: executionState.channel.youtubeChannelId,
            youtubeApiKey,
            cachedContextRow: executionState.channel.youtubeContext,
          });
        } catch (error) {
          logProviderSpend({
            provider: "youtube_context",
            operation: "refresh_context",
            outcome: "error",
            retryAttempt: youtubeRetryAttempt,
            durationMs: Date.now() - youtubeContextStartedAt,
          });

          if (isYoutubeChannelContextProviderError(error)) {
            throw new ServiceError(error.code, error.status, error.message);
          }

          throw error;
        }
      })();

      logProviderSpend({
        provider: "youtube_context",
        operation: "refresh_context",
        outcome: "fresh_call",
        retryAttempt: youtubeRetryAttempt,
        durationMs: Date.now() - youtubeContextStartedAt,
      });

      await prisma.channelEnrichment.update({
        where: {
          channelId: input.channelId,
        },
        data: {
          youtubeFetchedAt: new Date(),
        },
      });
    }

    let youtubeMetrics: ReturnType<typeof deriveYoutubeMetrics> | null = null;
    let enrichmentResult: {
      profile: ReturnType<typeof extractProfileFromRawPayload>;
      rawPayload: unknown;
    };
    const openAiRetryAttempt = executionState.rawOpenaiPayloadFetchedAt !== null;

    if (executionState.rawOpenaiPayloadFetchedAt !== null) {
      if (executionState.rawOpenaiPayload === null) {
        throw new ServiceError(
          "OPENAI_INVALID_STORED_PAYLOAD",
          500,
          "Stored OpenAI payload is invalid",
        );
      }

      enrichmentResult = {
        profile: extractProfileFromRawPayload(executionState.rawOpenaiPayload),
        rawPayload: executionState.rawOpenaiPayload,
      };
      logProviderSpend({
        provider: "openai",
        operation: "enrich_channel",
        outcome: "payload_reuse",
        retryAttempt: true,
        durationMs: 0,
      });
    } else {
      youtubeMetrics = deriveYoutubeMetrics(youtubeContext);
      const openAiStartedAt = Date.now();
      const result = await (async () => {
        try {
          return await enrichChannelWithOpenAi({
            channel: {
              youtubeChannelId: executionState.channel.youtubeChannelId,
              title: executionState.channel.title,
              handle: youtubeMetrics.normalizedHandle,
              description: executionState.channel.description,
            },
            youtubeContext: youtubeMetrics.context,
          });
        } catch (error) {
          logProviderSpend({
            provider: "openai",
            operation: "enrich_channel",
            outcome: "error",
            retryAttempt: openAiRetryAttempt,
            durationMs: Date.now() - openAiStartedAt,
          });

          if (isOpenAiChannelEnrichmentError(error)) {
            throw new ServiceError(error.code, error.status, error.message);
          }

          throw error;
        }
      })();

      const tokenUsage = extractTokenUsage(result.rawPayload);

      if (tokenUsage) {
        logProviderSpend({
          provider: "openai",
          operation: "enrich_channel",
          outcome: "fresh_call",
          retryAttempt: openAiRetryAttempt,
          durationMs: Date.now() - openAiStartedAt,
          tokenUsage,
        });
      } else {
        logProviderSpend({
          provider: "openai",
          operation: "enrich_channel",
          outcome: "fresh_call",
          retryAttempt: openAiRetryAttempt,
          durationMs: Date.now() - openAiStartedAt,
        });
      }

      await prisma.channelEnrichment.update({
        where: {
          channelId: input.channelId,
        },
        data: {
          rawOpenaiPayload: toJsonValue(result.rawPayload),
          rawOpenaiPayloadFetchedAt: new Date(),
        },
      });

      enrichmentResult = result;
    }

    youtubeMetrics ??= deriveYoutubeMetrics(youtubeContext);

    await prisma.$transaction(async (tx) => {
      await tx.channelYoutubeContext.update({
        where: {
          channelId: executionState.channel.id,
        },
        data: {
          context: toJsonValue(youtubeMetrics.context),
          lastError: null,
        },
      });

      await tx.channel.update({
        where: {
          id: executionState.channel.id,
        },
        data: {
          handle: youtubeMetrics.normalizedHandle,
          youtubeUrl: youtubeMetrics.canonicalUrl,
          description: executionState.channel.description ?? youtubeMetrics.context.description,
          thumbnailUrl: youtubeMetrics.context.thumbnailUrl,
        },
      });

      await tx.channelMetric.upsert({
        where: {
          channelId: executionState.channel.id,
        },
        create: {
          channelId: executionState.channel.id,
          subscriberCount: toNullableBigInt(youtubeMetrics.context.subscriberCount),
          viewCount: toNullableBigInt(youtubeMetrics.context.viewCount),
          videoCount: toNullableBigInt(youtubeMetrics.context.videoCount),
          youtubeAverageViews: toNullableBigInt(youtubeMetrics.averageViews),
          youtubeEngagementRate: youtubeMetrics.engagementRate,
          youtubeFollowers: toNullableBigInt(youtubeMetrics.context.subscriberCount),
        },
        update: {
          subscriberCount: toNullableBigInt(youtubeMetrics.context.subscriberCount),
          viewCount: toNullableBigInt(youtubeMetrics.context.viewCount),
          videoCount: toNullableBigInt(youtubeMetrics.context.videoCount),
          youtubeAverageViews: toNullableBigInt(youtubeMetrics.averageViews),
          youtubeEngagementRate: youtubeMetrics.engagementRate,
          youtubeFollowers: toNullableBigInt(youtubeMetrics.context.subscriberCount),
        },
      });

      await tx.channelEnrichment.update({
        where: {
          channelId: executionState.channelId,
        },
        data: {
          status: PrismaChannelEnrichmentStatus.COMPLETED,
          completedAt: new Date(),
          lastError: null,
          youtubeFetchedAt: null,
          rawOpenaiPayloadFetchedAt: null,
          summary: enrichmentResult.profile.summary,
          topics: toJsonValue(enrichmentResult.profile.topics),
          brandFitNotes: enrichmentResult.profile.brandFitNotes,
          confidence: enrichmentResult.profile.confidence,
        },
      });
    });
  } catch (error) {
    await prisma.channelEnrichment.update({
      where: {
        channelId: input.channelId,
      },
      data: {
        status: PrismaChannelEnrichmentStatus.FAILED,
        lastError: formatErrorMessage(error),
      },
    });

    throw error;
  }
}

export * from "./status";
