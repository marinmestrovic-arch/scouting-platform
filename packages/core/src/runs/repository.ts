import {
  CredentialProvider,
  RunRequestStatus as PrismaRunRequestStatus,
  RunResultSource as PrismaRunResultSource,
} from "@prisma/client";
import type { CreateRunResponse, RunRequestStatus, RunStatusResponse } from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";

import { getUserYoutubeApiKey } from "../auth";
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

export async function createRunRequest(input: {
  userId: string;
  name: string;
  query: string;
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

    const channels = await prisma.channel.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
      select: {
        id: true,
      },
    });

    if (channels.length > 0) {
      await prisma.runResult.createMany({
        data: channels.map((channel, index) => ({
          runRequestId: runRequest.id,
          channelId: channel.id,
          rank: index + 1,
          source: PrismaRunResultSource.CATALOG,
        })),
        skipDuplicates: true,
      });
    }

    await prisma.runRequest.update({
      where: {
        id: runRequest.id,
      },
      data: {
        status: PrismaRunRequestStatus.COMPLETED,
        completedAt: new Date(),
        lastError: null,
      },
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
