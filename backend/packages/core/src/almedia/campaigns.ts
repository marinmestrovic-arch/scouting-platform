import process from "node:process";

import { AlmediaSyncRunStatus as PrismaAlmediaSyncRunStatus } from "@prisma/client";
import type {
  AlmediaCampaignRow,
  AlmediaSyncStatus,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import {
  fetchAllCampaigns,
  type AlmediaCampaign,
} from "@scouting-platform/integrations";

import { recordAuditEvent } from "../audit";
import { ServiceError } from "../errors";
import { requireAlmediaAdminUser } from "./access";
import { enqueueAlmediaCampaignsSyncJob } from "./queue";
import { prepareAlmediaYoutubeEnrichments } from "./youtube-enrichment";

/**
 * Almedia campaign feed: worker-side sync into `almedia_campaign_snapshots`,
 * plus the read accessors the web tier uses. The web tier never calls the
 * provider — it reads the snapshot table and enqueues sync runs.
 */

const syncRunSelect = {
  id: true,
  status: true,
  agency: true,
  campaignCount: true,
  pageCount: true,
  duplicateCount: true,
  startedAt: true,
  completedAt: true,
  lastError: true,
} as const;

function resolveApiKey(): string {
  const apiKey = process.env.ALMEDIA_API_KEY?.trim();

  if (!apiKey) {
    throw new ServiceError(
      "ALMEDIA_API_KEY_MISSING",
      500,
      "ALMEDIA_API_KEY is not configured on this process",
    );
  }

  return apiKey;
}

function resolveBaseUrl(): string | undefined {
  return process.env.ALMEDIA_BASE_URL?.trim() || undefined;
}

function sanitizeErrorMessage(message: string): string {
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return firstLine.replace(/^[A-Za-z][A-Za-z0-9]*Error:\s*/, "") || "Unknown error";
}

function describeError(error: unknown): string {
  return sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
}

/**
 * The feed is expected to key on `campaignName`. Deduplicate defensively so a
 * duplicate cannot abort the whole sync, keeping the last row seen.
 */
function dedupeCampaigns(campaigns: readonly AlmediaCampaign[]): {
  unique: AlmediaCampaign[];
  duplicateCount: number;
} {
  const byName = new Map<string, AlmediaCampaign>();
  let duplicateCount = 0;

  for (const campaign of campaigns) {
    if (byName.has(campaign.campaignName)) {
      duplicateCount += 1;
    }

    byName.set(campaign.campaignName, campaign);
  }

  return { unique: [...byName.values()], duplicateCount };
}

/** Queue a sync run and return its durable run id. */
export async function requestAlmediaCampaignsSync(input: {
  requestedByUserId: string;
}): Promise<{ runId: string }> {
  await requireAlmediaAdminUser(input.requestedByUserId, "ALMEDIA_SYNC_FORBIDDEN");

  const run = await prisma.almediaSyncRun.create({
    data: {
      requestedByUserId: input.requestedByUserId,
      status: PrismaAlmediaSyncRunStatus.QUEUED,
    },
    select: { id: true },
  });

  await recordAuditEvent({
    actorUserId: input.requestedByUserId,
    action: "almedia.campaigns.sync.requested",
    entityType: "almedia_sync_run",
    entityId: run.id,
  });

  await enqueueOrFailRun(run.id, {
    initiatedBy: "admin",
    syncRunId: run.id,
    requestedByUserId: input.requestedByUserId,
  });

  return { runId: run.id };
}

/**
 * Enqueue the job, and fail the run if that does not happen.
 *
 * The run row is created before the job so the request has an id to return, but
 * that leaves a window: if pg-boss is unreachable, the row would otherwise sit
 * at `queued` forever with no `completedAt` and no `lastError`, and the hourly
 * schedule would mint another orphan on every retry. A run that no worker will
 * ever pick up is a failed run, and job durability requires it to say so.
 */
async function enqueueOrFailRun(
  runId: string,
  payload: Parameters<typeof enqueueAlmediaCampaignsSyncJob>[0],
): Promise<void> {
  try {
    await enqueueAlmediaCampaignsSyncJob(payload);
  } catch (error) {
    await prisma.almediaSyncRun.update({
      where: { id: runId },
      data: {
        status: PrismaAlmediaSyncRunStatus.FAILED,
        completedAt: new Date(),
        lastError: describeError(error),
      },
    });

    throw error;
  }
}

/** Queue the hourly sync run (no requesting user). */
export async function createScheduledAlmediaSyncRun(): Promise<{ runId: string }> {
  const run = await prisma.almediaSyncRun.create({
    data: { status: PrismaAlmediaSyncRunStatus.QUEUED },
    select: { id: true },
  });

  await enqueueOrFailRun(run.id, {
    initiatedBy: "system",
    syncRunId: run.id,
  });

  return { runId: run.id };
}

export interface AlmediaSyncResult {
  runId: string;
  agency: string;
  campaignCount: number;
  pageCount: number;
  duplicateCount: number;
  linkedEnrichmentCount: number;
  ingestedChannelCount: number;
  discoveredChannelCount: number;
  queuedEnrichmentCount: number;
  pendingEnrichmentCount: number;
  enrichmentRequesterMissing: boolean;
  enrichmentDiscoveryError: string | null;
}

/**
 * Fetch the whole campaign feed and replace the snapshot table with it, inside
 * one transaction so readers never observe a partial dataset. Run status,
 * timestamps, and lastError are persisted throughout (AGENTS.md §2.5).
 */
export async function syncAlmediaCampaigns(input: {
  syncRunId: string;
  now?: Date;
}): Promise<AlmediaSyncResult> {
  const syncedAt = input.now ?? new Date();

  const run = await prisma.almediaSyncRun.findUnique({
    where: { id: input.syncRunId },
    select: { id: true, status: true, requestedByUserId: true },
  });

  if (!run) {
    throw new ServiceError("ALMEDIA_SYNC_RUN_NOT_FOUND", 404, "Sync run not found");
  }

  if (run.status === PrismaAlmediaSyncRunStatus.COMPLETED) {
    throw new ServiceError(
      "ALMEDIA_SYNC_RUN_ALREADY_COMPLETED",
      409,
      "Sync run has already completed",
    );
  }

  await prisma.almediaSyncRun.update({
    where: { id: run.id },
    data: {
      status: PrismaAlmediaSyncRunStatus.RUNNING,
      startedAt: syncedAt,
      lastError: null,
    },
  });

  try {
    const baseUrl = resolveBaseUrl();
    const result = await fetchAllCampaigns({
      apiKey: resolveApiKey(),
      ...(baseUrl === undefined ? {} : { baseUrl }),
    });
    const { unique, duplicateCount } = dedupeCampaigns(result.campaigns);
    const automaticEnrichment = await prepareAlmediaYoutubeEnrichments({
      preferredRequesterUserId: run.requestedByUserId,
      campaigns: unique,
    });

    if (duplicateCount > 0) {
      process.stderr.write(
        `[almedia] feed contained ${duplicateCount} duplicate campaign name(s); kept the last row for each\n`,
      );
    }

    await withDbTransaction(async (tx) => {
      await tx.almediaCampaignSnapshot.deleteMany({});

      if (unique.length > 0) {
        await tx.almediaCampaignSnapshot.createMany({
          data: unique.map((campaign) => ({
            campaignName: campaign.campaignName,
            campaignSource: campaign.campaignSource,
            platform: campaign.platform,
            country: campaign.country,
            publishedAt: campaign.publishedAt,
            cost: campaign.cost,
            expectedCpm: campaign.expectedCpm,
            viewCount: campaign.viewCount,
            signupsPct: campaign.signupsPct,
            roasD7pD14: campaign.roasD7pD14,
            roasReturn: campaign.roasReturn,
            returnPct: campaign.returnPct,
            appuD14: campaign.appuD14,
            d7Purchases: campaign.d7Purchases,
            channelName: campaign.channelName,
            videoUrl: campaign.videoUrl,
            syncedAt,
          })),
        });
      }

      await tx.almediaSyncRun.update({
        where: { id: run.id },
        data: {
          status: PrismaAlmediaSyncRunStatus.COMPLETED,
          agency: result.agency,
          campaignCount: unique.length,
          pageCount: result.pages,
          duplicateCount,
          completedAt: new Date(),
          // Provider discovery is ancillary to the successful campaign sync.
          // The worker reports its warning without mislabeling this run failed.
          lastError: null,
        },
      });
    });

    return {
      runId: run.id,
      agency: result.agency,
      campaignCount: unique.length,
      pageCount: result.pages,
      duplicateCount,
      linkedEnrichmentCount: automaticEnrichment.linkedEnrichmentCount,
      ingestedChannelCount: automaticEnrichment.ingestedChannelCount,
      discoveredChannelCount: automaticEnrichment.discoveredChannelCount,
      queuedEnrichmentCount: automaticEnrichment.queuedEnrichmentCount,
      pendingEnrichmentCount: automaticEnrichment.pendingEnrichmentCount,
      enrichmentRequesterMissing: automaticEnrichment.requesterUserId === null,
      enrichmentDiscoveryError: automaticEnrichment.discoveryError,
    };
  } catch (error) {
    await prisma.almediaSyncRun.update({
      where: { id: run.id },
      data: {
        status: PrismaAlmediaSyncRunStatus.FAILED,
        completedAt: new Date(),
        lastError: describeError(error),
      },
    });

    throw error;
  }
}

const SYNC_STATUS_BY_PRISMA = {
  [PrismaAlmediaSyncRunStatus.QUEUED]: "queued",
  [PrismaAlmediaSyncRunStatus.RUNNING]: "running",
  [PrismaAlmediaSyncRunStatus.COMPLETED]: "completed",
  [PrismaAlmediaSyncRunStatus.FAILED]: "failed",
} as const satisfies Record<PrismaAlmediaSyncRunStatus, AlmediaSyncStatus["status"]>;

/** Latest sync run plus the freshness of the data currently stored. */
export async function getAlmediaSyncStatus(): Promise<AlmediaSyncStatus> {
  const [run, snapshot, campaignCount] = await Promise.all([
    prisma.almediaSyncRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: syncRunSelect,
    }),
    prisma.almediaCampaignSnapshot.findFirst({
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),
    prisma.almediaCampaignSnapshot.count(),
  ]);

  return {
    status: run ? SYNC_STATUS_BY_PRISMA[run.status] : null,
    agency: run?.agency ?? null,
    campaignCount,
    syncedAt: snapshot?.syncedAt.toISOString() ?? null,
    startedAt: run?.startedAt?.toISOString() ?? null,
    completedAt: run?.completedAt?.toISOString() ?? null,
    // Older runs may contain Error.stack from before failures were stored as
    // messages only. Never expose those internal paths through the web API.
    lastError: run?.lastError ? sanitizeErrorMessage(run.lastError) : null,
  };
}

/** Every stored campaign snapshot, newest publication first. */
export async function listAlmediaCampaigns(): Promise<AlmediaCampaignRow[]> {
  const rows = await prisma.almediaCampaignSnapshot.findMany({
    orderBy: [{ publishedAt: "desc" }, { campaignName: "asc" }],
  });

  return rows.map((row) => ({
    campaignName: row.campaignName,
    campaignSource: row.campaignSource,
    platform: row.platform,
    country: row.country,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    cost: row.cost,
    expectedCpm: row.expectedCpm,
    viewCount: row.viewCount,
    signupsPct: row.signupsPct,
    roasD7pD14: row.roasD7pD14,
    roasReturn: row.roasReturn,
    returnPct: row.returnPct,
    appuD14: row.appuD14,
    d7Purchases: row.d7Purchases,
    channelName: row.channelName,
    videoUrl: row.videoUrl,
  }));
}
