import { ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus } from "@prisma/client";
import type { ChannelEnrichmentStatus } from "@scouting-platform/contracts";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const CHANNEL_ENRICHMENT_STALE_WINDOW_DAYS = 14;
export const YOUTUBE_CONTEXT_FRESH_WINDOW_DAYS = 14;

type ChannelEnrichmentStatusSource = {
  status: PrismaChannelEnrichmentStatus;
  completedAt: Date | null;
};

export function isChannelEnrichmentStale(input: {
  channelUpdatedAt: Date;
  enrichment: ChannelEnrichmentStatusSource;
  now?: Date;
}): boolean {
  if (input.enrichment.status === PrismaChannelEnrichmentStatus.STALE) {
    return true;
  }

  if (input.enrichment.status !== PrismaChannelEnrichmentStatus.COMPLETED) {
    return false;
  }

  if (!input.enrichment.completedAt) {
    return true;
  }

  const now = input.now ?? new Date();
  const completedAtMs = input.enrichment.completedAt.getTime();

  return (
    input.channelUpdatedAt.getTime() > completedAtMs ||
    now.getTime() - completedAtMs >= CHANNEL_ENRICHMENT_STALE_WINDOW_DAYS * DAY_IN_MS
  );
}

export function resolveChannelEnrichmentStatus(input: {
  channelUpdatedAt: Date;
  enrichment: ChannelEnrichmentStatusSource | null;
  now?: Date;
}): ChannelEnrichmentStatus {
  if (!input.enrichment) {
    return "missing";
  }

  if (
    isChannelEnrichmentStale({
      channelUpdatedAt: input.channelUpdatedAt,
      enrichment: input.enrichment,
      ...(input.now ? { now: input.now } : {}),
    })
  ) {
    return "stale";
  }

  if (input.enrichment.status === PrismaChannelEnrichmentStatus.RUNNING) {
    return "running";
  }

  if (input.enrichment.status === PrismaChannelEnrichmentStatus.COMPLETED) {
    return "completed";
  }

  if (input.enrichment.status === PrismaChannelEnrichmentStatus.FAILED) {
    return "failed";
  }

  return "queued";
}

export function isYoutubeContextFresh(input: { fetchedAt: Date | null | undefined; now?: Date }): boolean {
  if (!input.fetchedAt) {
    return false;
  }

  const now = input.now ?? new Date();
  return now.getTime() - input.fetchedAt.getTime() < YOUTUBE_CONTEXT_FRESH_WINDOW_DAYS * DAY_IN_MS;
}
