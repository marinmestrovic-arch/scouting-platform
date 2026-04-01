import { createHash } from "node:crypto";

import {
  CredentialProvider,
  Role,
  RunMonth as PrismaRunMonth,
  RunRequestStatus as PrismaRunRequestStatus,
  RunResultSource as PrismaRunResultSource,
  UserType,
  type Prisma,
} from "@prisma/client";
import type {
  CreateRunResponse,
  ListRecentRunsResponse,
  RunFilterOptions,
  RunMetadataInput,
  RunMetadataResponse,
  RunMonth,
  RunRequestStatus,
  RunStatusResponse,
} from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";
import {
  discoverYoutubeChannels,
  isYoutubeDiscoveryProviderError,
  type YoutubeDiscoveredChannel,
} from "@scouting-platform/integrations";

import { getUserYoutubeApiKey } from "../auth";
import { upsertChannelSkeleton } from "../channels";
import { ServiceError } from "../errors";
import { logProviderSpend } from "../telemetry";
import { enqueueRunsDiscoverJob } from "./queue";

const campaignManagerSelect = {
  id: true,
  email: true,
  name: true,
} as const;

const runMetadataSelect = {
  campaignId: true,
  client: true,
  market: true,
  campaignManagerUserId: true,
  briefLink: true,
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
  campaignManagerUser: {
    select: campaignManagerSelect,
  },
} as const;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const YOUTUBE_DISCOVERY_CACHE_TTL_MINUTES = Number(
  process.env.YOUTUBE_DISCOVERY_CACHE_TTL_MINUTES?.trim() || "30",
);

function buildDiscoveryCacheKey(
  query: string,
  userId: string,
  maxResults: number,
): string {
  const normalized = query.trim().toLowerCase().replaceAll(/\s+/g, " ");

  return createHash("sha256")
    .update(JSON.stringify({ query: normalized, userId, maxResults }))
    .digest("hex");
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

function toRunMonth(month: PrismaRunMonth | null): RunMonth | null {
  switch (month) {
    case PrismaRunMonth.JANUARY:
      return "january";
    case PrismaRunMonth.FEBRUARY:
      return "february";
    case PrismaRunMonth.MARCH:
      return "march";
    case PrismaRunMonth.APRIL:
      return "april";
    case PrismaRunMonth.MAY:
      return "may";
    case PrismaRunMonth.JUNE:
      return "june";
    case PrismaRunMonth.JULY:
      return "july";
    case PrismaRunMonth.AUGUST:
      return "august";
    case PrismaRunMonth.SEPTEMBER:
      return "september";
    case PrismaRunMonth.OCTOBER:
      return "october";
    case PrismaRunMonth.NOVEMBER:
      return "november";
    case PrismaRunMonth.DECEMBER:
      return "december";
    default:
      return null;
  }
}

function toRunMetadata(
  runRequest: Prisma.RunRequestGetPayload<{ select: typeof runMetadataSelect }>,
): RunMetadataResponse {
  return {
    campaignId: runRequest.campaignId,
    client: runRequest.client,
    market: runRequest.market,
    campaignManagerUserId: runRequest.campaignManagerUserId,
    campaignManager: runRequest.campaignManagerUser
      ? {
          id: runRequest.campaignManagerUser.id,
          email: runRequest.campaignManagerUser.email,
          name: runRequest.campaignManagerUser.name,
        }
      : null,
    briefLink: runRequest.briefLink,
    campaignName: runRequest.campaignName,
    month: toRunMonth(runRequest.month),
    year: runRequest.year,
    dealOwner: runRequest.dealOwner,
    dealName: runRequest.dealName,
    pipeline: runRequest.pipeline,
    dealStage: runRequest.dealStage,
    currency: runRequest.currency,
    dealType: runRequest.dealType,
    activationType: runRequest.activationType,
    hubspotInfluencerType: runRequest.hubspotInfluencerType,
    hubspotInfluencerVertical: runRequest.hubspotInfluencerVertical,
    hubspotCountryRegion: runRequest.hubspotCountryRegion,
    hubspotLanguage: runRequest.hubspotLanguage,
  };
}

type CatalogCandidate = {
  id: string;
};

async function validateCampaignManagerUser(userId: string): Promise<void> {
  const campaignManager = await prisma.user.findFirst({
    where: {
      id: userId,
      isActive: true,
      role: Role.USER,
      userType: UserType.CAMPAIGN_MANAGER,
    },
    select: {
      id: true,
    },
  });

  if (!campaignManager) {
    throw new ServiceError(
      "CAMPAIGN_MANAGER_INVALID",
      400,
      "Selected campaign manager must be an active Campaign Manager user",
    );
  }
}

async function loadRunCreationMetadata(input: {
  campaignId: string;
  userId: string;
  campaignManagerUserId?: string;
}): Promise<Pick<
  Prisma.RunRequestUncheckedCreateInput,
  | "campaignId"
  | "client"
  | "market"
  | "campaignManagerUserId"
  | "briefLink"
  | "campaignName"
  | "month"
  | "year"
  | "dealOwner"
  | "dealName"
  | "pipeline"
  | "dealStage"
  | "dealType"
  | "activationType"
  | "hubspotInfluencerType"
  | "hubspotInfluencerVertical"
  | "hubspotCountryRegion"
  | "hubspotLanguage"
>> {
  const [campaign, user] = await Promise.all([
    prisma.campaign.findUnique({
      where: {
        id: input.campaignId,
      },
      select: {
        id: true,
        name: true,
        briefLink: true,
        month: true,
        year: true,
        isActive: true,
        client: {
          select: {
            name: true,
          },
        },
        market: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.user.findUnique({
      where: {
        id: input.userId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        userType: true,
      },
    }),
  ]);

  if (!campaign || !campaign.isActive) {
    throw new ServiceError("CAMPAIGN_NOT_FOUND", 400, "Selected campaign is not available");
  }

  if (!user) {
    throw new ServiceError("USER_NOT_FOUND", 404, "User not found");
  }

  const campaignManagerUserId =
    input.campaignManagerUserId ??
    (user.userType === UserType.CAMPAIGN_MANAGER ? user.id : null);

  if (campaignManagerUserId) {
    await validateCampaignManagerUser(campaignManagerUserId);
  }

  const selectedCampaignManager = campaignManagerUserId
    ? await prisma.user.findUnique({
        where: {
          id: campaignManagerUserId,
        },
        select: {
          email: true,
          name: true,
        },
      })
    : null;

  return {
    campaignId: campaign.id,
    client: campaign.client.name,
    market: campaign.market.name,
    campaignManagerUserId,
    briefLink: campaign.briefLink,
    campaignName: campaign.name,
    month: campaign.month,
    year: campaign.year,
    dealOwner:
      selectedCampaignManager?.name?.trim() ||
      selectedCampaignManager?.email ||
      user.name?.trim() ||
      user.email,
    dealName: campaign.name,
    pipeline: "Sales Pipeline",
    dealStage: "Scouted",
    dealType: "",
    activationType: "",
    hubspotInfluencerType: "YouTube Creator",
    hubspotInfluencerVertical: "",
    hubspotCountryRegion: "",
    hubspotLanguage: "",
  };
}

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

function buildRunScopeWhere(input: {
  userId: string;
  role: "admin" | "user";
}): Prisma.RunRequestWhereInput {
  if (input.role === "admin") {
    return {};
  }

  return {
    requestedByUserId: input.userId,
  };
}

function buildRunListWhere(input: {
  userId: string;
  role: "admin" | "user";
  campaignManagerUserId?: string;
  client?: string;
  market?: string;
}): Prisma.RunRequestWhereInput {
  const scopedWhere = buildRunScopeWhere({
    userId: input.userId,
    role: input.role,
  });

  return {
    ...scopedWhere,
    ...(input.campaignManagerUserId
      ? {
          campaignManagerUserId: input.campaignManagerUserId,
        }
      : {}),
    ...(input.client
      ? {
          client: input.client.trim(),
        }
      : {}),
    ...(input.market
      ? {
          market: input.market.trim(),
        }
      : {}),
  };
}

function uniqueSorted(values: readonly (string | null)[]): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

async function getRunFilterOptions(input: {
  userId: string;
  role: "admin" | "user";
}): Promise<RunFilterOptions> {
  const runs = await prisma.runRequest.findMany({
    where: buildRunScopeWhere({
      userId: input.userId,
      role: input.role,
    }),
    select: {
      client: true,
      market: true,
      campaignManagerUser: {
        select: campaignManagerSelect,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const campaignManagers = new Map<string, RunFilterOptions["campaignManagers"][number]>();

  for (const run of runs) {
    if (!run.campaignManagerUser) {
      continue;
    }

    campaignManagers.set(run.campaignManagerUser.id, {
      id: run.campaignManagerUser.id,
      email: run.campaignManagerUser.email,
      name: run.campaignManagerUser.name,
    });
  }

  return {
    campaignManagers: [...campaignManagers.values()].sort((left, right) =>
      (left.name?.trim() || left.email).localeCompare(right.name?.trim() || right.email),
    ),
    clients: uniqueSorted(runs.map((run) => run.client)),
    markets: uniqueSorted(runs.map((run) => run.market)),
  };
}

export async function createRunRequest(input: {
  userId: string;
  name: string;
  query: string;
  target: number;
  metadata: RunMetadataInput;
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

  const runMetadata = await loadRunCreationMetadata({
    campaignId: input.metadata.campaignId,
    userId: input.userId,
    ...(input.metadata.campaignManagerUserId
      ? { campaignManagerUserId: input.metadata.campaignManagerUserId }
      : {}),
  });

  const runRequestCreateInput: Prisma.RunRequestUncheckedCreateInput = {
    requestedByUserId: input.userId,
    name: input.name.trim(),
    query: input.query.trim(),
    target: input.target,
    status: PrismaRunRequestStatus.QUEUED,
    ...runMetadata,
  };

  const runRequest = await prisma.runRequest.create({
    data: runRequestCreateInput,
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
  role: "admin" | "user";
  limit?: number;
  campaignManagerUserId?: string;
  client?: string;
  market?: string;
}): Promise<ListRecentRunsResponse> {
  const limit = Math.max(1, Math.floor(input.limit ?? 50));

  // Run both queries in parallel instead of sequentially.
  const [runRequests, filterOptions] = await Promise.all([
    prisma.runRequest.findMany({
      where: buildRunListWhere(input),
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
        ...runMetadataSelect,
        _count: {
          select: {
            results: true,
          },
        },
      },
    }),
    getRunFilterOptions({
      userId: input.userId,
      role: input.role,
    }),
  ]);

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
      metadata: toRunMetadata(runRequest),
    })),
    filterOptions,
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
      ...runMetadataSelect,
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
    metadata: toRunMetadata(runRequest),
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

    const MAX_RESULTS = 50;
    const now = new Date();
    const cacheKey = buildDiscoveryCacheKey(
      runRequest.query,
      input.requestedByUserId,
      MAX_RESULTS,
    );
    const cacheHit = await prisma.youtubeDiscoveryCache.findUnique({
      where: {
        cacheKey,
      },
      select: {
        payload: true,
        expiresAt: true,
      },
    });

    let discovered: YoutubeDiscoveredChannel[];

    if (cacheHit && cacheHit.expiresAt > now) {
      discovered = cacheHit.payload as YoutubeDiscoveredChannel[];
      logProviderSpend({
        provider: "youtube_discovery",
        operation: "discover_channels",
        outcome: "cache_hit",
        retryAttempt: false,
        durationMs: 0,
      });
    } else {
      const providerCallStartedAt = Date.now();

      try {
        const rawDiscovered = await discoverYoutubeChannels({
          apiKey: youtubeKey,
          query: runRequest.query,
          maxResults: MAX_RESULTS,
        });

        discovered = rawDiscovered;

        logProviderSpend({
          provider: "youtube_discovery",
          operation: "discover_channels",
          outcome: "fresh_call",
          retryAttempt: false,
          durationMs: Date.now() - providerCallStartedAt,
        });

        const expiresAt = new Date(
          Date.now() + YOUTUBE_DISCOVERY_CACHE_TTL_MINUTES * 60 * 1000,
        );

        await prisma.youtubeDiscoveryCache.upsert({
          where: {
            cacheKey,
          },
          create: {
            cacheKey,
            userId: input.requestedByUserId,
            query: runRequest.query,
            maxResults: MAX_RESULTS,
            payload: toJsonValue(rawDiscovered),
            fetchedAt: now,
            expiresAt,
          },
          update: {
            payload: toJsonValue(rawDiscovered),
            fetchedAt: now,
            expiresAt,
          },
        });
      } catch (error) {
        logProviderSpend({
          provider: "youtube_discovery",
          operation: "discover_channels",
          outcome: "error",
          retryAttempt: false,
          durationMs: Date.now() - providerCallStartedAt,
        });

        if (isYoutubeDiscoveryProviderError(error)) {
          throw new ServiceError(error.code, error.status, error.message);
        }

        throw error;
      }
    }

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
