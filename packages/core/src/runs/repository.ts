import {
  CredentialProvider,
  type Prisma,
  RunRequestStatus as PrismaRunRequestStatus,
  RunResultSource as PrismaRunResultSource,
} from "@prisma/client";
import type {
  CreateRunResponse,
  ListRecentRunsResponse,
  RunRequestStatus,
  RunStatusResponse,
} from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";
import {
  discoverYoutubeChannels,
  isYoutubeDiscoveryProviderError,
} from "@scouting-platform/integrations";

import { getUserYoutubeApiKey } from "../auth";
import { upsertChannelSkeleton } from "../channels";
import { ServiceError } from "../errors";
import { enqueueRunsDiscoverJob } from "./queue";

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toRunRequestStatus(status: PrismaRunRequestStatus): RunRequestStatus {
  if (status === PrismaRunRequestStatus.RUNNING) {
    return "running";
  }

  if (status === PrismaRunRequestStatus.COMPLETED) {
    return "completed";
  }

  if (status === PrismaRunRequestStatus.FAILED) {
    return "failed";
  }

  return "queued";
}

function toRunResultSource(source: PrismaRunResultSource): "catalog" | "discovery" {
  return source === PrismaRunResultSource.DISCOVERY ? "discovery" : "catalog";
}

type CatalogCandidate = {
  id: string;
};

async function getCatalogCandidatesForQuery(query: string): Promise<CatalogCandidate[]> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return [];
  }

  const where: Prisma.ChannelWhereInput = {
    OR: [
      {
        title: {
          contains: normalizedQuery,
          mode: "insensitive",
        },
      },
      {
        handle: {
          contains: normalizedQuery,
          mode: "insensitive",
        },
      },
      {
        youtubeChannelId: {
          contains: normalizedQuery,
          mode: "insensitive",
        },
      },
    ],
  };

  return prisma.channel.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
    select: {
      id: true,
    },
  });
}

export async function createRunRequest(input: {
  userId: string;
  name: string;
  query: string;
  target: number;
}): Promise<CreateRunResponse> {
  const hasYoutubeKey = await prisma.userProviderCredential.findUnique({
    where: {
      userId_provider: {
        userId: input.userId,
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
      "Assigned YouTube API key is required before creating a run",
    );
  }

  const runRequest = await prisma.runRequest.create({
    data: {
      requestedByUserId: input.userId,
      name: input.name.trim(),
      query: input.query.trim(),
      target: input.target,
      status: PrismaRunRequestStatus.QUEUED,
    },
    select: {
      id: true,
      status: true,
    },
  });

  try {
    await enqueueRunsDiscoverJob({
      runRequestId: runRequest.id,
      requestedByUserId: input.userId,
    });
  } catch (error) {
    await prisma.runRequest.update({
      where: {
        id: runRequest.id,
      },
      data: {
        status: PrismaRunRequestStatus.FAILED,
        lastError: formatErrorMessage(error),
      },
    });
    throw new ServiceError(
      "RUN_ENQUEUE_FAILED",
      500,
      "Failed to enqueue run discovery job",
    );
  }

  return {
    runId: runRequest.id,
    status: toRunRequestStatus(runRequest.status),
  };
}

export async function listRecentRuns(input: {
  userId: string;
  limit?: number;
}): Promise<ListRecentRunsResponse> {
  const limit = Math.max(1, Math.floor(input.limit ?? 10));
  const runRequests = await prisma.runRequest.findMany({
    where: {
      requestedByUserId: input.userId,
    },
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    take: limit,
    select: {
      id: true,
      name: true,
      query: true,
      target: true,
      status: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      completedAt: true,
      _count: {
        select: {
          results: true,
        },
      },
    },
  });

  return {
    items: runRequests.map((runRequest) => ({
      id: runRequest.id,
      name: runRequest.name,
      query: runRequest.query,
      target: runRequest.target,
      status: toRunRequestStatus(runRequest.status),
      lastError: runRequest.lastError,
      createdAt: runRequest.createdAt.toISOString(),
      updatedAt: runRequest.updatedAt.toISOString(),
      startedAt: runRequest.startedAt?.toISOString() ?? null,
      completedAt: runRequest.completedAt?.toISOString() ?? null,
      resultCount: runRequest._count.results,
    })),
  };
}

export async function getRunStatus(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
}): Promise<RunStatusResponse> {
  const runRequest = await prisma.runRequest.findUnique({
    where: {
      id: input.runId,
    },
    select: {
      id: true,
      requestedByUserId: true,
      name: true,
      query: true,
      target: true,
      status: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      completedAt: true,
      results: {
        orderBy: {
          rank: "asc",
        },
        select: {
          id: true,
          channelId: true,
          rank: true,
          source: true,
          createdAt: true,
          channel: {
            select: {
              id: true,
              youtubeChannelId: true,
              title: true,
              handle: true,
              thumbnailUrl: true,
            },
          },
        },
      },
    },
  });

  if (!runRequest) {
    throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found");
  }

  if (input.role !== "admin" && runRequest.requestedByUserId !== input.userId) {
    throw new ServiceError("RUN_FORBIDDEN", 403, "Forbidden");
  }

  return {
    id: runRequest.id,
    requestedByUserId: runRequest.requestedByUserId,
    name: runRequest.name,
    query: runRequest.query,
    target: runRequest.target,
    status: toRunRequestStatus(runRequest.status),
    lastError: runRequest.lastError,
    createdAt: runRequest.createdAt.toISOString(),
    updatedAt: runRequest.updatedAt.toISOString(),
    startedAt: runRequest.startedAt?.toISOString() ?? null,
    completedAt: runRequest.completedAt?.toISOString() ?? null,
    results: runRequest.results.map((result) => ({
      id: result.id,
      channelId: result.channelId,
      rank: result.rank,
      source: toRunResultSource(result.source),
      createdAt: result.createdAt.toISOString(),
      channel: {
        id: result.channel.id,
        youtubeChannelId: result.channel.youtubeChannelId,
        title: result.channel.title,
        handle: result.channel.handle,
        thumbnailUrl: result.channel.thumbnailUrl,
      },
    })),
  };
}

export async function executeRunDiscover(input: {
  runRequestId: string;
  requestedByUserId: string;
}): Promise<void> {
  const runRequest = await prisma.runRequest.findUnique({
    where: {
      id: input.runRequestId,
    },
    select: {
      id: true,
      requestedByUserId: true,
      status: true,
      query: true,
    },
  });

  if (!runRequest) {
    return;
  }

  if (runRequest.requestedByUserId !== input.requestedByUserId) {
    await prisma.runRequest.update({
      where: {
        id: runRequest.id,
      },
      data: {
        status: PrismaRunRequestStatus.FAILED,
        lastError: "Run payload user mismatch",
        completedAt: new Date(),
      },
    });
    return;
  }

  if (
    runRequest.status === PrismaRunRequestStatus.RUNNING ||
    runRequest.status === PrismaRunRequestStatus.COMPLETED
  ) {
    return;
  }

  const claimed = await prisma.runRequest.updateMany({
    where: {
      id: runRequest.id,
      status: {
        in: [PrismaRunRequestStatus.QUEUED, PrismaRunRequestStatus.FAILED],
      },
    },
    data: {
      status: PrismaRunRequestStatus.RUNNING,
      startedAt: new Date(),
      completedAt: null,
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  try {
    const youtubeKey = await getUserYoutubeApiKey(input.requestedByUserId);

    if (!youtubeKey) {
      throw new ServiceError(
        "YOUTUBE_KEY_REQUIRED",
        400,
        "Assigned YouTube API key is required for discovery",
      );
    }

    const catalogCandidates = await getCatalogCandidatesForQuery(runRequest.query);
    const catalogCandidateIds = new Set(catalogCandidates.map((candidate) => candidate.id));

    const discovered = await (async () => {
      try {
        return await discoverYoutubeChannels({
          apiKey: youtubeKey,
          query: runRequest.query,
          maxResults: 50,
        });
      } catch (error) {
        if (isYoutubeDiscoveryProviderError(error)) {
          throw new ServiceError(error.code, error.status, error.message);
        }

        throw error;
      }
    })();

    const existingDiscoveredChannels = await prisma.channel.findMany({
      where: {
        youtubeChannelId: {
          in: discovered.map((channel) => channel.youtubeChannelId),
        },
      },
      select: {
        id: true,
        youtubeChannelId: true,
      },
    });
    const existingDiscoveredChannelIds = new Set(
      existingDiscoveredChannels.map((channel) => channel.id),
    );
    const additionalCatalogChannelIds: string[] = [];
    const addedAdditionalCatalog = new Set<string>();
    const discoveryOnlyChannelIds: string[] = [];
    const addedDiscoveryOnly = new Set<string>();

    for (const channel of discovered) {
      const upserted = await upsertChannelSkeleton(channel);

      if (catalogCandidateIds.has(upserted.id)) {
        continue;
      }

      if (existingDiscoveredChannelIds.has(upserted.id)) {
        if (addedAdditionalCatalog.has(upserted.id)) {
          continue;
        }

        addedAdditionalCatalog.add(upserted.id);
        additionalCatalogChannelIds.push(upserted.id);
        continue;
      }

      if (addedDiscoveryOnly.has(upserted.id)) {
        continue;
      }

      addedDiscoveryOnly.add(upserted.id);
      discoveryOnlyChannelIds.push(upserted.id);
    }

    const rankedResults = [
      ...catalogCandidates.map((channelId) => ({
        channelId: channelId.id,
        source: PrismaRunResultSource.CATALOG,
      })),
      ...additionalCatalogChannelIds.map((channelId) => ({
        channelId,
        source: PrismaRunResultSource.CATALOG,
      })),
      ...discoveryOnlyChannelIds.map((channelId) => ({
        channelId,
        source: PrismaRunResultSource.DISCOVERY,
      })),
    ];

    await prisma.$transaction(async (tx) => {
      await tx.runResult.deleteMany({
        where: {
          runRequestId: runRequest.id,
        },
      });

      if (rankedResults.length > 0) {
        await tx.runResult.createMany({
          data: rankedResults.map((result, index) => ({
            runRequestId: runRequest.id,
            channelId: result.channelId,
            rank: index + 1,
            source: result.source,
          })),
        });
      }

      await tx.runRequest.update({
        where: {
          id: runRequest.id,
        },
        data: {
          status: PrismaRunRequestStatus.COMPLETED,
          completedAt: new Date(),
          lastError: null,
        },
      });
    });
  } catch (error) {
    await prisma.runRequest.update({
      where: {
        id: runRequest.id,
      },
      data: {
        status: PrismaRunRequestStatus.FAILED,
        completedAt: new Date(),
        lastError: formatErrorMessage(error),
      },
    });
    throw error;
  }
}
