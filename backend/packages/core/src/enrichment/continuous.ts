import {
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
  CredentialProvider,
  Prisma,
} from "@prisma/client";
import type { JobPayloadByName } from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";

import { CHANNEL_ENRICHMENT_STALE_WINDOW_DAYS } from "./status";

type ChannelLlmEnrichmentPayload = JobPayloadByName["channels.enrich.llm"];
type ChannelLlmEnrichmentEnqueue = (
  payload: ChannelLlmEnrichmentPayload,
) => Promise<void>;

type ChannelLlmEnrichmentCandidateReason =
  | "missing"
  | "stale"
  | "failed_retry"
  | "running_timeout"
  | "queued_timeout";

type DueChannelLlmEnrichmentCandidateRow = {
  channelId: string;
  requestedByUserId: string;
  hasEnrichment: boolean;
  reason: ChannelLlmEnrichmentCandidateReason;
};

export type QueueDueChannelLlmEnrichmentsResult = Readonly<{
  scannedAt: Date;
  staleThreshold: Date;
  queued: number;
  skipped: number;
  failed: number;
  missingYoutubeCredential: boolean;
  queuedChannelIds: string[];
}>;

export const CONTINUOUS_CHANNEL_ENRICHMENT_DEFAULT_BATCH_SIZE = 5;
export const CONTINUOUS_CHANNEL_ENRICHMENT_MAX_BATCH_SIZE = 50;
export const CHANNEL_LLM_ENRICHMENT_DEFAULT_MAX_RETRY_COUNT = 5;
export const CHANNEL_LLM_ENRICHMENT_MAX_RETRY_COUNT = 25;
export const CHANNEL_LLM_ENRICHMENT_DEFAULT_PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;
export const CHANNEL_LLM_ENRICHMENT_DEFAULT_QUEUED_TIMEOUT_MS = 10 * 60 * 1000;
export const CHANNEL_LLM_ENRICHMENT_RETRY_BASE_DELAY_MS = 5 * 60 * 1000;
export const CHANNEL_LLM_ENRICHMENT_RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1000;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function normalizeContinuousEnrichmentBatchSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return CONTINUOUS_CHANNEL_ENRICHMENT_DEFAULT_BATCH_SIZE;
  }

  return Math.min(
    Math.max(1, Math.trunc(value)),
    CONTINUOUS_CHANNEL_ENRICHMENT_MAX_BATCH_SIZE,
  );
}

function normalizeContinuousEnrichmentStaleDays(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return CHANNEL_ENRICHMENT_STALE_WINDOW_DAYS;
  }

  return Math.max(1, Math.trunc(value));
}

function normalizeContinuousEnrichmentMaxRetryCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return CHANNEL_LLM_ENRICHMENT_DEFAULT_MAX_RETRY_COUNT;
  }

  return Math.min(
    Math.max(1, Math.trunc(value)),
    CHANNEL_LLM_ENRICHMENT_MAX_RETRY_COUNT,
  );
}

function normalizePositiveDurationMs(value: number | undefined, defaultValue: number): number {
  if (!value || !Number.isFinite(value)) {
    return defaultValue;
  }

  return Math.max(1, Math.trunc(value));
}

function getChannelLlmEnrichmentRetryDelayMs(retryCount: number): number {
  const retryIndex = Math.max(0, retryCount - 1);
  const delayMs = CHANNEL_LLM_ENRICHMENT_RETRY_BASE_DELAY_MS * (2 ** retryIndex);

  return Math.min(delayMs, CHANNEL_LLM_ENRICHMENT_RETRY_MAX_DELAY_MS);
}

function getChannelLlmEnrichmentNextRetryAt(input: {
  failedAt: Date;
  retryCount: number;
}): Date {
  return new Date(
    input.failedAt.getTime() + getChannelLlmEnrichmentRetryDelayMs(input.retryCount),
  );
}

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code
  );
}

async function listDueChannelLlmEnrichmentCandidates(input: {
  batchSize: number;
  staleThreshold: Date;
  processingStaleThreshold: Date;
  queuedStaleThreshold: Date;
  maxRetryCount: number;
  now: Date;
}): Promise<DueChannelLlmEnrichmentCandidateRow[]> {
  // Continuous jobs must use a channel-related requester, never an arbitrary credential.
  return prisma.$queryRaw<DueChannelLlmEnrichmentCandidateRow[]>(Prisma.sql`
    WITH raw_candidates AS (
      SELECT
        ce.channel_id,
        requester.user_id AS requested_by_user_id,
        TRUE AS has_enrichment,
        CASE
          WHEN ce.status::text = 'failed' THEN 'failed_retry'
          WHEN ce.status::text = 'running' THEN 'running_timeout'
          WHEN ce.status::text = 'queued' THEN 'queued_timeout'
          ELSE 'stale'
        END AS reason,
        CASE
          WHEN ce.status::text = 'failed' THEN 0
          WHEN ce.status::text = 'queued' THEN 1
          WHEN ce.status::text = 'running' THEN 2
          WHEN ce.last_enriched_at IS NULL THEN 0
          ELSE 3
        END AS due_rank,
        COALESCE(ce.next_retry_at, ce.last_enriched_at, ce.started_at, ce.requested_at, ce.updated_at) AS due_at,
        0 AS source_rank
      FROM channel_enrichments ce
      INNER JOIN channels c
        ON c.id = ce.channel_id
      LEFT JOIN LATERAL (
        SELECT candidate.user_id
        FROM (
          SELECT
            ce.requested_by_user_id AS user_id,
            0 AS source_rank,
            COALESCE(ce.last_enriched_at, ce.requested_at, ce.created_at) AS source_at
          WHERE
            ce.last_enriched_at IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM audit_events ae
              WHERE
                ae.entity_type = 'channel'
                AND ae.entity_id = ce.channel_id::text
                AND ae.action = 'channel.enrichment.requested'
                AND ae.actor_user_id = ce.requested_by_user_id
            )

          UNION ALL

          SELECT
            cib.requested_by_user_id AS user_id,
            1 AS source_rank,
            cib.created_at AS source_at
          FROM csv_import_rows cir
          INNER JOIN csv_import_batches cib
            ON cib.id = cir.batch_id
          WHERE
            cir.channel_id = ce.channel_id
            AND cir.status::text = 'imported'

          UNION ALL

          SELECT
            rr.requested_by_user_id AS user_id,
            2 AS source_rank,
            rr.created_at AS source_at
          FROM run_results result
          INNER JOIN run_requests rr
            ON rr.id = result.run_request_id
          WHERE
            result.channel_id = ce.channel_id
        ) candidate
        INNER JOIN user_provider_credentials credential
          ON credential.user_id = candidate.user_id
          AND credential.provider::text = 'youtube_data_api'
        ORDER BY
          candidate.source_rank ASC,
          candidate.source_at DESC
        LIMIT 1
      ) requester ON TRUE
      WHERE
        c.youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'
        AND requester.user_id IS NOT NULL
        AND (
          (
            ce.status::text IN ('missing', 'stale')
            AND (
              ce.last_enriched_at IS NULL
              OR ce.last_enriched_at <= ${input.staleThreshold}
            )
          )
          OR (
            ce.status::text = 'completed'
            AND COALESCE(ce.last_enriched_at, ce.completed_at) <= ${input.staleThreshold}
          )
          OR (
            ce.status::text = 'failed'
            AND ce.retry_count < ${input.maxRetryCount}
            AND (ce.next_retry_at IS NULL OR ce.next_retry_at <= ${input.now})
            AND (
              ce.last_enriched_at IS NULL
              OR ce.last_enriched_at <= ${input.staleThreshold}
              OR ce.requested_at > ce.last_enriched_at
            )
          )
          OR (
            ce.status::text = 'running'
            AND ce.retry_count < ${input.maxRetryCount}
            AND ce.started_at <= ${input.processingStaleThreshold}
          )
          OR (
            ce.status::text = 'queued'
            AND ce.requested_at <= ${input.queuedStaleThreshold}
          )
        )

      UNION ALL

      SELECT *
      FROM (
        SELECT DISTINCT ON (cir.channel_id)
          cir.channel_id,
          cib.requested_by_user_id,
          FALSE AS has_enrichment,
          'missing' AS reason,
          0 AS due_rank,
          cib.created_at AS due_at,
          1 AS source_rank
        FROM csv_import_rows cir
        INNER JOIN csv_import_batches cib
          ON cib.id = cir.batch_id
        INNER JOIN channels c
          ON c.id = cir.channel_id
        INNER JOIN user_provider_credentials credential
          ON credential.user_id = cib.requested_by_user_id
          AND credential.provider::text = 'youtube_data_api'
        LEFT JOIN channel_enrichments ce
          ON ce.channel_id = cir.channel_id
        WHERE
          cir.status::text = 'imported'
          AND cir.channel_id IS NOT NULL
          AND ce.channel_id IS NULL
          AND c.youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'
        ORDER BY
          cir.channel_id,
          cib.created_at DESC
      ) import_missing

      UNION ALL

      SELECT *
      FROM (
        SELECT DISTINCT ON (result.channel_id)
          result.channel_id,
          rr.requested_by_user_id,
          FALSE AS has_enrichment,
          'missing' AS reason,
          0 AS due_rank,
          rr.created_at AS due_at,
          2 AS source_rank
        FROM run_results result
        INNER JOIN run_requests rr
          ON rr.id = result.run_request_id
        INNER JOIN channels c
          ON c.id = result.channel_id
        INNER JOIN user_provider_credentials credential
          ON credential.user_id = rr.requested_by_user_id
          AND credential.provider::text = 'youtube_data_api'
        LEFT JOIN channel_enrichments ce
          ON ce.channel_id = result.channel_id
        WHERE
          ce.channel_id IS NULL
          AND c.youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'
        ORDER BY
          result.channel_id,
          rr.created_at DESC
      ) run_missing
    ),
    deduped AS (
      SELECT DISTINCT ON (channel_id)
        channel_id,
        requested_by_user_id,
        has_enrichment,
        reason,
        due_rank,
        due_at
      FROM raw_candidates
      ORDER BY
        channel_id,
        source_rank ASC,
        due_at DESC
    )
    SELECT
      channel_id AS "channelId",
      requested_by_user_id AS "requestedByUserId",
      has_enrichment AS "hasEnrichment",
      reason AS "reason"
    FROM deduped
    ORDER BY
      due_rank ASC,
      due_at ASC,
      channel_id ASC
    LIMIT ${input.batchSize}
  `);
}

async function claimDueChannelLlmEnrichment(input: {
  candidate: DueChannelLlmEnrichmentCandidateRow;
  requestedAt: Date;
  staleThreshold: Date;
  processingStaleThreshold: Date;
  queuedStaleThreshold: Date;
  maxRetryCount: number;
}): Promise<boolean> {
  if (!input.candidate.hasEnrichment) {
    try {
      await prisma.channelEnrichment.create({
        data: {
          channelId: input.candidate.channelId,
          status: PrismaChannelEnrichmentStatus.QUEUED,
          requestedByUserId: input.candidate.requestedByUserId,
          requestedAt: input.requestedAt,
          retryCount: 0,
          nextRetryAt: null,
        },
      });

      return true;
    } catch (error) {
      if (isPrismaErrorCode(error, "P2002")) {
        return false;
      }

      throw error;
    }
  }

  const statusWhere = (() => {
    switch (input.candidate.reason) {
      case "failed_retry":
        return {
          status: PrismaChannelEnrichmentStatus.FAILED,
          retryCount: {
            lt: input.maxRetryCount,
          },
          OR: [
            {
              nextRetryAt: null,
            },
            {
              nextRetryAt: {
                lte: input.requestedAt,
              },
            },
          ],
        } satisfies Prisma.ChannelEnrichmentWhereInput;
      case "running_timeout":
        return {
          status: PrismaChannelEnrichmentStatus.RUNNING,
          retryCount: {
            lt: input.maxRetryCount,
          },
          startedAt: {
            lte: input.processingStaleThreshold,
          },
        } satisfies Prisma.ChannelEnrichmentWhereInput;
      case "queued_timeout":
        return {
          status: PrismaChannelEnrichmentStatus.QUEUED,
          requestedAt: {
            lte: input.queuedStaleThreshold,
          },
        } satisfies Prisma.ChannelEnrichmentWhereInput;
      case "stale":
      case "missing":
        return {
          OR: [
            {
              status: {
                in: [
                  PrismaChannelEnrichmentStatus.MISSING,
                  PrismaChannelEnrichmentStatus.STALE,
                ],
              },
            },
            {
              status: PrismaChannelEnrichmentStatus.COMPLETED,
              OR: [
                {
                  lastEnrichedAt: {
                    lte: input.staleThreshold,
                  },
                },
                {
                  lastEnrichedAt: null,
                  completedAt: {
                    lte: input.staleThreshold,
                  },
                },
              ],
            },
          ],
        } satisfies Prisma.ChannelEnrichmentWhereInput;
    }
  })();
  const updateData: Prisma.ChannelEnrichmentUncheckedUpdateManyInput = {
    status: PrismaChannelEnrichmentStatus.QUEUED,
    requestedByUserId: input.candidate.requestedByUserId,
    requestedAt: input.requestedAt,
    startedAt: null,
    lastError: null,
    nextRetryAt: null,
    youtubeFetchedAt: null,
    rawOpenaiPayloadFetchedAt: null,
  };

  if (input.candidate.reason === "running_timeout") {
    updateData.retryCount = {
      increment: 1,
    };
  } else if (
    input.candidate.reason === "stale"
    || input.candidate.reason === "missing"
  ) {
    updateData.retryCount = 0;
  }

  const claimed = await prisma.channelEnrichment.updateMany({
    where: {
      channelId: input.candidate.channelId,
      ...statusWhere,
    },
    data: updateData,
  });

  return claimed.count > 0;
}

export async function markChannelLlmEnrichmentFailed(input: {
  channelId: string;
  error: unknown;
  failedAt?: Date;
}): Promise<void> {
  const failedAt = input.failedAt ?? new Date();
  const lastError = formatErrorMessage(input.error);

  // Use optimistic compare-and-set retries so failure marking still works even
  // if callback-style transaction hooks are interrupted by surrounding tests/mocks.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const enrichment = await prisma.channelEnrichment.findUnique({
      where: {
        channelId: input.channelId,
      },
      select: {
        retryCount: true,
      },
    });

    if (!enrichment) {
      return;
    }

    const retryCount = enrichment.retryCount + 1;
    const updated = await prisma.channelEnrichment.updateMany({
      where: {
        channelId: input.channelId,
        retryCount: enrichment.retryCount,
      },
      data: {
        status: PrismaChannelEnrichmentStatus.FAILED,
        retryCount,
        nextRetryAt: getChannelLlmEnrichmentNextRetryAt({
          failedAt,
          retryCount,
        }),
        lastError,
      },
    });

    if (updated.count > 0) {
      return;
    }
  }

  const enrichment = await prisma.channelEnrichment.findUnique({
    where: {
      channelId: input.channelId,
    },
    select: {
      retryCount: true,
    },
  });

  if (!enrichment) {
    return;
  }

  const retryCount = enrichment.retryCount + 1;

  await prisma.channelEnrichment.update({
    where: {
      channelId: input.channelId,
    },
    data: {
      status: PrismaChannelEnrichmentStatus.FAILED,
      retryCount,
      nextRetryAt: getChannelLlmEnrichmentNextRetryAt({
        failedAt,
        retryCount,
      }),
      lastError,
    },
  });
}

export async function queueDueChannelLlmEnrichments(input: {
  enqueue: ChannelLlmEnrichmentEnqueue;
  batchSize?: number;
  staleAfterDays?: number;
  maxRetryCount?: number;
  processingTimeoutMs?: number;
  queuedTimeoutMs?: number;
  now?: Date;
}): Promise<QueueDueChannelLlmEnrichmentsResult> {
  const scannedAt = input.now ?? new Date();
  const batchSize = normalizeContinuousEnrichmentBatchSize(input.batchSize);
  const staleAfterDays = normalizeContinuousEnrichmentStaleDays(input.staleAfterDays);
  const maxRetryCount = normalizeContinuousEnrichmentMaxRetryCount(input.maxRetryCount);
  const processingTimeoutMs = normalizePositiveDurationMs(
    input.processingTimeoutMs,
    CHANNEL_LLM_ENRICHMENT_DEFAULT_PROCESSING_TIMEOUT_MS,
  );
  const queuedTimeoutMs = normalizePositiveDurationMs(
    input.queuedTimeoutMs,
    CHANNEL_LLM_ENRICHMENT_DEFAULT_QUEUED_TIMEOUT_MS,
  );
  const staleThreshold = new Date(scannedAt.getTime() - staleAfterDays * DAY_IN_MS);
  const processingStaleThreshold = new Date(scannedAt.getTime() - processingTimeoutMs);
  const queuedStaleThreshold = new Date(scannedAt.getTime() - queuedTimeoutMs);
  const anyYoutubeCredential = await prisma.userProviderCredential.findFirst({
    where: {
      provider: CredentialProvider.YOUTUBE_DATA_API,
    },
    select: {
      id: true,
    },
  });

  if (!anyYoutubeCredential) {
    return {
      scannedAt,
      staleThreshold,
      queued: 0,
      skipped: 0,
      failed: 0,
      missingYoutubeCredential: true,
      queuedChannelIds: [],
    };
  }

  const candidates = await listDueChannelLlmEnrichmentCandidates({
    batchSize,
    staleThreshold,
    processingStaleThreshold,
    queuedStaleThreshold,
    maxRetryCount,
    now: scannedAt,
  });
  let skipped = 0;
  let failed = 0;
  const queuedChannelIds: string[] = [];

  for (const candidate of candidates) {
    const claimed = await claimDueChannelLlmEnrichment({
      candidate,
      requestedAt: scannedAt,
      staleThreshold,
      processingStaleThreshold,
      queuedStaleThreshold,
      maxRetryCount,
    });

    if (!claimed) {
      skipped += 1;
      continue;
    }

    try {
      await input.enqueue({
        channelId: candidate.channelId,
        requestedByUserId: candidate.requestedByUserId,
      });

      queuedChannelIds.push(candidate.channelId);
    } catch (error) {
      failed += 1;
      await markChannelLlmEnrichmentFailed({
        channelId: candidate.channelId,
        error,
        failedAt: scannedAt,
      });
    }
  }

  return {
    scannedAt,
    staleThreshold,
    queued: queuedChannelIds.length,
    skipped,
    failed,
    missingYoutubeCredential: false,
    queuedChannelIds,
  };
}
