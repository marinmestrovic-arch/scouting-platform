import {
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
  Prisma,
  RunChannelAssessmentStatus as PrismaRunChannelAssessmentStatus,
  RunRequestStatus as PrismaRunRequestStatus,
} from "@prisma/client";
import type {
  RunChannelAssessmentItem,
  RunMetadataResponse,
  TriggerRunAssessmentResponse,
  UpdateRunBriefRequest,
} from "@scouting-platform/contracts";
import { updateRunBriefRequestSchema } from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";
import {
  enrichCampaignFitWithOpenAi,
  extractOpenAiCampaignFitFromRawPayload,
  isOpenAiCampaignFitError,
  type EnrichCampaignFitResult,
  type YoutubeChannelContext,
} from "@scouting-platform/integrations";

import { ServiceError } from "../errors";
import { enqueueJob } from "../queue";
import { logProviderSpend } from "../telemetry";
import {
  parseStringArrayOrNull,
  runMetadataSelect,
  toRunChannelAssessmentItem,
  toRunMetadata,
} from "./repository";

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function hasPopulatedBrief(run: {
  clientIndustry: string | null;
  campaignObjective: string | null;
  targetAudienceAge: string | null;
  targetAudienceGender: string | null;
  targetGeographies: Prisma.JsonValue | null;
  contentRestrictions: Prisma.JsonValue | null;
  budgetTier: string | null;
  deliverables: Prisma.JsonValue | null;
}): boolean {
  const stringFields = [
    run.clientIndustry,
    run.campaignObjective,
    run.targetAudienceAge,
    run.targetAudienceGender,
    run.budgetTier,
  ];

  if (stringFields.some((value) => value?.trim())) {
    return true;
  }

  const arrayFields = [
    parseStringArrayOrNull(run.targetGeographies),
    parseStringArrayOrNull(run.contentRestrictions),
    parseStringArrayOrNull(run.deliverables),
  ];

  return arrayFields.some((value) => (value?.length ?? 0) > 0);
}

function buildMinimalYoutubeContext(channel: {
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  contentLanguage: string | null;
}): YoutubeChannelContext {
  return {
    youtubeChannelId: channel.youtubeChannelId,
    title: channel.title,
    handle: channel.handle,
    description: channel.description,
    thumbnailUrl: channel.thumbnailUrl,
    publishedAt: null,
    defaultLanguage: channel.contentLanguage,
    subscriberCount: null,
    viewCount: null,
    videoCount: null,
    recentVideos: [],
    diagnostics: {
      warnings: [],
    },
  };
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

  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || !Number.isFinite(total)) {
    return undefined;
  }

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
  };
}

async function loadAuthorizedRunOrThrow(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
}): Promise<{ id: string; requestedByUserId: string }> {
  const runRequest = await prisma.runRequest.findUnique({
    where: {
      id: input.runId,
    },
    select: {
      id: true,
      requestedByUserId: true,
    },
  });

  if (!runRequest) {
    throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found");
  }

  if (input.role !== "admin" && runRequest.requestedByUserId !== input.userId) {
    throw new ServiceError("RUN_FORBIDDEN", 403, "You do not have access to this run");
  }

  return runRequest;
}

export async function enqueueRunAssessChannelFitJob(payload: {
  runRequestId: string;
  channelId: string;
  requestedByUserId: string;
}): Promise<void> {
  await enqueueJob("runs.assess.channel-fit", payload);
}

export async function requestRunAssessment(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
}): Promise<TriggerRunAssessmentResponse> {
  const runRequest = await prisma.runRequest.findUnique({
    where: {
      id: input.runId,
    },
    select: {
      id: true,
      requestedByUserId: true,
      status: true,
      clientIndustry: true,
      campaignObjective: true,
      targetAudienceAge: true,
      targetAudienceGender: true,
      targetGeographies: true,
      contentRestrictions: true,
      budgetTier: true,
      deliverables: true,
      results: {
        orderBy: {
          rank: "asc",
        },
        select: {
          channelId: true,
        },
      },
    },
  });

  if (!runRequest) {
    throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found");
  }

  if (input.role !== "admin" && runRequest.requestedByUserId !== input.userId) {
    throw new ServiceError("RUN_FORBIDDEN", 403, "You do not have access to this run");
  }

  if (runRequest.status !== PrismaRunRequestStatus.COMPLETED) {
    throw new ServiceError(
      "RUN_NOT_COMPLETED",
      409,
      "Run must be completed before assessment",
    );
  }

  if (!hasPopulatedBrief(runRequest)) {
    throw new ServiceError("RUN_BRIEF_MISSING", 400, "Run has no campaign brief populated");
  }

  const uniqueChannelIds = [...new Set(runRequest.results.map((result) => result.channelId))];
  const queuedAssessmentIds = new Set<string>();

  await prisma.$transaction(async (tx) => {
    const existingRows = await tx.runChannelAssessment.findMany({
      where: {
        runRequestId: input.runId,
        channelId: {
          in: uniqueChannelIds,
        },
      },
    });
    const existingByChannelId = new Map(existingRows.map((row) => [row.channelId, row] as const));

    for (const channelId of uniqueChannelIds) {
      const existing = existingByChannelId.get(channelId);

      if (!existing) {
        const created = await tx.runChannelAssessment.create({
          data: {
            runRequestId: input.runId,
            channelId,
            status: PrismaRunChannelAssessmentStatus.QUEUED,
          },
        });
        queuedAssessmentIds.add(created.id);
        continue;
      }

      if (
        existing.status === PrismaRunChannelAssessmentStatus.COMPLETED ||
        existing.status === PrismaRunChannelAssessmentStatus.FAILED
      ) {
        const updated = await tx.runChannelAssessment.update({
          where: {
            id: existing.id,
          },
          data: {
            status: PrismaRunChannelAssessmentStatus.QUEUED,
            model: null,
            fitScore: null,
            fitReasons: Prisma.DbNull,
            fitConcerns: Prisma.DbNull,
            recommendedAngles: Prisma.DbNull,
            avoidTopics: Prisma.DbNull,
            startedAt: null,
            assessedAt: null,
            rawOpenaiPayload: Prisma.DbNull,
            rawOpenaiPayloadFetchedAt: null,
            lastError: null,
          },
        });
        queuedAssessmentIds.add(updated.id);
      }
    }
  });

  let enqueued = 0;
  let skipped = uniqueChannelIds.length - queuedAssessmentIds.size;

  if (queuedAssessmentIds.size > 0) {
    const queuedRows = await prisma.runChannelAssessment.findMany({
      where: {
        id: {
          in: [...queuedAssessmentIds],
        },
      },
      select: {
        id: true,
        runRequestId: true,
        channelId: true,
      },
    });

    for (const row of queuedRows) {
      try {
        await enqueueRunAssessChannelFitJob({
          runRequestId: row.runRequestId,
          channelId: row.channelId,
          requestedByUserId: input.userId,
        });
        enqueued += 1;
      } catch (error) {
        skipped += 1;
        await prisma.runChannelAssessment.update({
          where: {
            id: row.id,
          },
          data: {
            status: PrismaRunChannelAssessmentStatus.FAILED,
            lastError: formatErrorMessage(error),
          },
        });
      }
    }
  }

  const assessments = await prisma.runChannelAssessment.findMany({
    where: {
      runRequestId: input.runId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return {
    runId: input.runId,
    enqueued,
    skipped,
    assessments: assessments.map(toRunChannelAssessmentItem),
  };
}

export async function executeRunChannelFitAssessment(input: {
  runRequestId: string;
  channelId: string;
  requestedByUserId: string;
}): Promise<void> {
  const claim = await prisma.runChannelAssessment.updateMany({
    where: {
      runRequestId: input.runRequestId,
      channelId: input.channelId,
      status: {
        in: [
          PrismaRunChannelAssessmentStatus.QUEUED,
          PrismaRunChannelAssessmentStatus.FAILED,
        ],
      },
    },
    data: {
      status: PrismaRunChannelAssessmentStatus.RUNNING,
      startedAt: new Date(),
      lastError: null,
    },
  });

  if (claim.count === 0) {
    return;
  }

  try {
    const row = await prisma.runChannelAssessment.findUnique({
      where: {
        runRequestId_channelId: {
          runRequestId: input.runRequestId,
          channelId: input.channelId,
        },
      },
      include: {
        runRequest: true,
        channel: true,
      },
    });

    if (!row) {
      return;
    }

    const [youtubeContextRow, enrichmentRow] = await Promise.all([
      prisma.channelYoutubeContext.findUnique({
        where: {
          channelId: input.channelId,
        },
        select: {
          context: true,
        },
      }),
      prisma.channelEnrichment.findUnique({
        where: {
          channelId: input.channelId,
        },
        select: {
          status: true,
          summary: true,
          topics: true,
          brandFitNotes: true,
        },
      }),
    ]);

    const brief = {
      client: row.runRequest.client,
      campaignName: row.runRequest.campaignName,
      clientIndustry: row.runRequest.clientIndustry,
      campaignObjective: row.runRequest.campaignObjective,
      targetAudienceAge: row.runRequest.targetAudienceAge,
      targetAudienceGender: row.runRequest.targetAudienceGender,
      targetGeographies: parseStringArrayOrNull(row.runRequest.targetGeographies),
      contentRestrictions: parseStringArrayOrNull(row.runRequest.contentRestrictions),
      budgetTier: row.runRequest.budgetTier,
      deliverables: parseStringArrayOrNull(row.runRequest.deliverables),
    };

    let result: EnrichCampaignFitResult;

    if (row.rawOpenaiPayload) {
      result = {
        profile: extractOpenAiCampaignFitFromRawPayload(row.rawOpenaiPayload),
        rawPayload: row.rawOpenaiPayload as Record<string, unknown>,
        model: "gpt-4.1-mini",
      };
      logProviderSpend({
        provider: "openai",
        operation: "assess_run_channel_fit",
        outcome: "payload_reuse",
        retryAttempt: row.rawOpenaiPayloadFetchedAt !== null,
        durationMs: 0,
      });
    } else {
      const startedAt = Date.now();

      try {
        result = await enrichCampaignFitWithOpenAi({
          channel: {
            youtubeChannelId: row.channel.youtubeChannelId,
            title: row.channel.title,
            handle: row.channel.handle,
            description: row.channel.description,
          },
          youtubeContext:
            youtubeContextRow?.context &&
            typeof youtubeContextRow.context === "object" &&
            youtubeContextRow.context !== null
              ? (youtubeContextRow.context as YoutubeChannelContext)
              : buildMinimalYoutubeContext(row.channel),
          enrichmentProfile:
            enrichmentRow?.status === PrismaChannelEnrichmentStatus.COMPLETED &&
            enrichmentRow.summary
              ? {
                  summary: enrichmentRow.summary,
                  topics: parseStringArrayOrNull(enrichmentRow.topics) ?? [],
                  brandFitNotes: enrichmentRow.brandFitNotes ?? "",
                }
              : null,
          campaignBrief: brief,
        });
      } catch (error) {
        logProviderSpend({
          provider: "openai",
          operation: "assess_run_channel_fit",
          outcome: "error",
          retryAttempt: row.rawOpenaiPayloadFetchedAt !== null,
          durationMs: Date.now() - startedAt,
        });

        if (isOpenAiCampaignFitError(error)) {
          throw new ServiceError(error.code, error.status, error.message);
        }

        throw error;
      }

      const tokenUsage = extractTokenUsage(result.rawPayload);

      logProviderSpend({
        provider: "openai",
        operation: "assess_run_channel_fit",
        outcome: "fresh_call",
        retryAttempt: row.rawOpenaiPayloadFetchedAt !== null,
        durationMs: Date.now() - startedAt,
        ...(tokenUsage ? { tokenUsage } : {}),
      });

      await prisma.runChannelAssessment.update({
        where: {
          id: row.id,
        },
        data: {
          rawOpenaiPayload: toJsonValue(result.rawPayload),
          rawOpenaiPayloadFetchedAt: new Date(),
        },
      });
    }

    await prisma.runChannelAssessment.update({
      where: {
        id: row.id,
      },
      data: {
        status: PrismaRunChannelAssessmentStatus.COMPLETED,
        model: result.model,
        fitScore: result.profile.fitScore,
        fitReasons: toJsonValue(result.profile.fitReasons),
        fitConcerns: toJsonValue(result.profile.fitConcerns),
        recommendedAngles: toJsonValue(result.profile.recommendedAngles),
        avoidTopics: toJsonValue(result.profile.avoidTopics),
        assessedAt: new Date(),
        lastError: null,
      },
    });
  } catch (error) {
    await prisma.runChannelAssessment.updateMany({
      where: {
        runRequestId: input.runRequestId,
        channelId: input.channelId,
        status: PrismaRunChannelAssessmentStatus.RUNNING,
      },
      data: {
        status: PrismaRunChannelAssessmentStatus.FAILED,
        lastError: formatErrorMessage(error),
      },
    });

    throw error;
  }
}

export async function getRunAssessments(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
}): Promise<RunChannelAssessmentItem[]> {
  await loadAuthorizedRunOrThrow(input);

  const assessments = await prisma.runChannelAssessment.findMany({
    where: {
      runRequestId: input.runId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return assessments.map(toRunChannelAssessmentItem);
}

export async function updateRunBrief(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
  brief: UpdateRunBriefRequest;
}): Promise<RunMetadataResponse> {
  await loadAuthorizedRunOrThrow(input);
  const brief = updateRunBriefRequestSchema.parse(input.brief);

  const updated = await prisma.runRequest.update({
    where: {
      id: input.runId,
    },
    data: {
      ...(brief.clientIndustry !== undefined
        ? { clientIndustry: brief.clientIndustry ?? null }
        : {}),
      ...(brief.campaignObjective !== undefined
        ? { campaignObjective: brief.campaignObjective ?? null }
        : {}),
      ...(brief.targetAudienceAge !== undefined
        ? { targetAudienceAge: brief.targetAudienceAge ?? null }
        : {}),
      ...(brief.targetAudienceGender !== undefined
        ? { targetAudienceGender: brief.targetAudienceGender ?? null }
        : {}),
      ...(brief.targetGeographies !== undefined
        ? {
            targetGeographies:
              brief.targetGeographies === null
                ? Prisma.DbNull
                : toJsonValue(brief.targetGeographies),
          }
        : {}),
      ...(brief.contentRestrictions !== undefined
        ? {
            contentRestrictions:
              brief.contentRestrictions === null
                ? Prisma.DbNull
                : toJsonValue(brief.contentRestrictions),
          }
        : {}),
      ...(brief.budgetTier !== undefined ? { budgetTier: brief.budgetTier ?? null } : {}),
      ...(brief.deliverables !== undefined
        ? {
            deliverables:
              brief.deliverables === null ? Prisma.DbNull : toJsonValue(brief.deliverables),
          }
        : {}),
    },
    select: runMetadataSelect,
  });

  return toRunMetadata(updated);
}
