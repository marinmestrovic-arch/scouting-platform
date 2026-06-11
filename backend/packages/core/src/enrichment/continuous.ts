import {
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
  ChannelYoutubeRefreshStatus as PrismaChannelYoutubeRefreshStatus,
  CredentialProvider,
  Prisma,
} from "@prisma/client";
import type { JobPayloadByName } from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";

import {
  CHANNEL_ENRICHMENT_STALE_WINDOW_DAYS,
  YOUTUBE_CONTEXT_FRESH_WINDOW_DAYS,
} from "./status";

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

type ChannelYoutubeRefreshCandidateReason =
  | "youtube_missing"
  | "youtube_stale"
  | "youtube_failed_retry"
  | "youtube_running_timeout"
  | "youtube_queued_timeout";

type DueChannelLlmEnrichmentCandidateRow = {
  channelId: string;
  requestedByUserId: string;
  hasEnrichment: boolean;
  reason: ChannelLlmEnrichmentCandidateReason;
};

type DueChannelYoutubeRefreshCandidateRow = {
  channelId: string;
  requestedByUserId: string;
  hasYoutubeContext: boolean;
  reason: ChannelYoutubeRefreshCandidateReason;
};

export type QueueDueChannelLlmEnrichmentsResult = Readonly<{
  scannedAt: Date;
  staleThreshold: Date;
  aiStaleThreshold: Date;
  youtubeStaleThreshold: Date;
  queued: number;
  queuedFull: number;
  queuedYoutubeOnly: number;
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

function normalizeContinuousEnrichmentStaleDays(
  value: number | undefined,
  defaultValue: number,
): number {
  if (!value || !Number.isFinite(value)) {
    return defaultValue;
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

async function listDueChannelYoutubeRefreshCandidates(input: {
  batchSize: number;
  aiStaleThreshold: Date;
  youtubeStaleThreshold: Date;
  processingStaleThreshold: Date;
  queuedStaleThreshold: Date;
  maxRetryCount: number;
  now: Date;
  excludedChannelIds: readonly string[];
}): Promise<DueChannelYoutubeRefreshCandidateRow[]> {
  if (input.batchSize <= 0) {
    return [];
  }

  const excludedChannelIdsFilter = input.excludedChannelIds.length > 0
    ? Prisma.sql`AND c.id <> ALL(ARRAY[${Prisma.join(input.excludedChannelIds)}]::uuid[])`
    : Prisma.empty;

  return prisma.$queryRaw<DueChannelYoutubeRefreshCandidateRow[]>(Prisma.sql`
    SELECT
      c.id AS "channelId",
      requester.user_id AS "requestedByUserId",
      (cyc.channel_id IS NOT NULL) AS "hasYoutubeContext",
      CASE
        WHEN cyc.channel_id IS NULL THEN 'youtube_missing'
        WHEN cyc.refresh_status::text = 'failed' THEN 'youtube_failed_retry'
        WHEN cyc.refresh_status::text = 'running' THEN 'youtube_running_timeout'
        WHEN cyc.refresh_status::text = 'queued' THEN 'youtube_queued_timeout'
        ELSE 'youtube_stale'
      END AS "reason"
    FROM channels c
    INNER JOIN channel_enrichments ce
      ON ce.channel_id = c.id
    LEFT JOIN channel_youtube_contexts cyc
      ON cyc.channel_id = c.id
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
          cir.channel_id = c.id
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
          result.channel_id = c.id
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
      ${excludedChannelIdsFilter}
      AND NOT (
        (
          ce.status::text IN ('missing', 'stale')
          AND (
            ce.last_enriched_at IS NULL
            OR ce.last_enriched_at <= ${input.aiStaleThreshold}
          )
        )
        OR (
          ce.status::text = 'completed'
          AND COALESCE(ce.last_enriched_at, ce.completed_at) <= ${input.aiStaleThreshold}
        )
        OR (
          ce.status::text = 'failed'
          AND ce.retry_count < ${input.maxRetryCount}
          AND (ce.next_retry_at IS NULL OR ce.next_retry_at <= ${input.now})
          AND (
            ce.last_enriched_at IS NULL
            OR ce.last_enriched_at <= ${input.aiStaleThreshold}
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
      AND (
        cyc.channel_id IS NULL
        OR (
          cyc.refresh_status::text IN ('idle', 'completed')
          AND (
            cyc.fetched_at IS NULL
            OR cyc.fetched_at <= ${input.youtubeStaleThreshold}
          )
        )
        OR (
          cyc.refresh_status::text = 'failed'
          AND cyc.refresh_retry_count < ${input.maxRetryCount}
          AND (cyc.refresh_next_retry_at IS NULL OR cyc.refresh_next_retry_at <= ${input.now})
        )
        OR (
          cyc.refresh_status::text = 'running'
          AND cyc.refresh_retry_count < ${input.maxRetryCount}
          AND cyc.refresh_started_at <= ${input.processingStaleThreshold}
        )
        OR (
          cyc.refresh_status::text = 'queued'
          AND cyc.refresh_requested_at <= ${input.queuedStaleThreshold}
        )
      )
    ORDER BY
      CASE
        WHEN cyc.channel_id IS NULL THEN 0
        WHEN cyc.refresh_status::text = 'failed' THEN 0
        WHEN cyc.refresh_status::text = 'queued' THEN 1
        WHEN cyc.refresh_status::text = 'running' THEN 2
        WHEN cyc.fetched_at IS NULL THEN 0
        ELSE 3
      END ASC,
      COALESCE(
        cyc.refresh_next_retry_at,
        cyc.fetched_at,
        cyc.refresh_started_at,
        cyc.refresh_requested_at,
        c.updated_at
      ) ASC,
      c.id ASC
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

async function claimDueChannelYoutubeRefresh(input: {
  candidate: DueChannelYoutubeRefreshCandidateRow;
  requestedAt: Date;
  youtubeStaleThreshold: Date;
  processingStaleThreshold: Date;
  queuedStaleThreshold: Date;
  maxRetryCount: number;
}): Promise<boolean> {
  if (!input.candidate.hasYoutubeContext) {
    try {
      await prisma.channelYoutubeContext.create({
        data: {
          channelId: input.candidate.channelId,
          context: Prisma.DbNull,
          fetchedAt: null,
          lastError: null,
          refreshStatus: PrismaChannelYoutubeRefreshStatus.QUEUED,
          refreshRequestedAt: input.requestedAt,
          refreshStartedAt: null,
          refreshCompletedAt: null,
          refreshRetryCount: 0,
          refreshNextRetryAt: null,
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
      case "youtube_failed_retry":
        return {
          refreshStatus: PrismaChannelYoutubeRefreshStatus.FAILED,
          refreshRetryCount: {
            lt: input.maxRetryCount,
          },
          OR: [
            {
              refreshNextRetryAt: null,
            },
            {
              refreshNextRetryAt: {
                lte: input.requestedAt,
              },
            },
          ],
        } satisfies Prisma.ChannelYoutubeContextWhereInput;
      case "youtube_running_timeout":
        return {
          refreshStatus: PrismaChannelYoutubeRefreshStatus.RUNNING,
          refreshRetryCount: {
            lt: input.maxRetryCount,
          },
          refreshStartedAt: {
            lte: input.processingStaleThreshold,
          },
        } satisfies Prisma.ChannelYoutubeContextWhereInput;
      case "youtube_queued_timeout":
        return {
          refreshStatus: PrismaChannelYoutubeRefreshStatus.QUEUED,
          refreshRequestedAt: {
            lte: input.queuedStaleThreshold,
          },
        } satisfies Prisma.ChannelYoutubeContextWhereInput;
      case "youtube_missing":
      case "youtube_stale":
        return {
          OR: [
            {
              refreshStatus: {
                in: [
                  PrismaChannelYoutubeRefreshStatus.IDLE,
                  PrismaChannelYoutubeRefreshStatus.COMPLETED,
                ],
              },
              OR: [
                {
                  fetchedAt: null,
                },
                {
                  fetchedAt: {
                    lte: input.youtubeStaleThreshold,
                  },
                },
              ],
            },
            {
              refreshStatus: PrismaChannelYoutubeRefreshStatus.FAILED,
              refreshRetryCount: {
                lt: input.maxRetryCount,
              },
              OR: [
                {
                  refreshNextRetryAt: null,
                },
                {
                  refreshNextRetryAt: {
                    lte: input.requestedAt,
                  },
                },
              ],
            },
          ],
        } satisfies Prisma.ChannelYoutubeContextWhereInput;
    }
  })();
  const updateData: Prisma.ChannelYoutubeContextUncheckedUpdateManyInput = {
    refreshStatus: PrismaChannelYoutubeRefreshStatus.QUEUED,
    refreshRequestedAt: input.requestedAt,
    refreshStartedAt: null,
    refreshNextRetryAt: null,
    lastError: null,
  };

  if (input.candidate.reason === "youtube_running_timeout") {
    updateData.refreshRetryCount = {
      increment: 1,
    };
  } else if (
    input.candidate.reason === "youtube_stale"
    || input.candidate.reason === "youtube_missing"
  ) {
    updateData.refreshRetryCount = 0;
  }

  const claimed = await prisma.channelYoutubeContext.updateMany({
    where: {
      channelId: input.candidate.channelId,
      ...statusWhere,
    },
    data: updateData,
  });

  return claimed.count > 0;
}

export async function markChannelYoutubeRefreshFailed(input: {
  channelId: string;
  error: unknown;
  failedAt?: Date;
}): Promise<void> {
  const failedAt = input.failedAt ?? new Date();
  const lastError = formatErrorMessage(input.error);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const context = await prisma.channelYoutubeContext.findUnique({
      where: {
        channelId: input.channelId,
      },
      select: {
        refreshRetryCount: true,
      },
    });

    if (!context) {
      return;
    }

    const refreshRetryCount = context.refreshRetryCount + 1;
    const updated = await prisma.channelYoutubeContext.updateMany({
      where: {
        channelId: input.channelId,
        refreshRetryCount: context.refreshRetryCount,
      },
      data: {
        refreshStatus: PrismaChannelYoutubeRefreshStatus.FAILED,
        refreshRetryCount,
        refreshNextRetryAt: getChannelLlmEnrichmentNextRetryAt({
          failedAt,
          retryCount: refreshRetryCount,
        }),
        lastError,
      },
    });

    if (updated.count > 0) {
      return;
    }
  }

  const context = await prisma.channelYoutubeContext.findUnique({
    where: {
      channelId: input.channelId,
    },
    select: {
      refreshRetryCount: true,
    },
  });

  if (!context) {
    return;
  }

  const refreshRetryCount = context.refreshRetryCount + 1;

  await prisma.channelYoutubeContext.update({
    where: {
      channelId: input.channelId,
    },
    data: {
      refreshStatus: PrismaChannelYoutubeRefreshStatus.FAILED,
      refreshRetryCount,
      refreshNextRetryAt: getChannelLlmEnrichmentNextRetryAt({
        failedAt,
        retryCount: refreshRetryCount,
      }),
      lastError,
    },
  });
}

export async function markChannelLlmEnrichmentFailed(input: {
  channelId: string;
  error: unknown;
  failedAt?: Date;
}): Promise<void> {
  const failedAt = input.failedAt ?? new Date();
  const lastError = formatErrorMessage(input.error);
  const failureEligibleStatuses: PrismaChannelEnrichmentStatus[] = [
    PrismaChannelEnrichmentStatus.QUEUED,
    PrismaChannelEnrichmentStatus.RUNNING,
    PrismaChannelEnrichmentStatus.STALE,
  ];

  // Use optimistic compare-and-set retries so failure marking still works even
  // if callback-style transaction hooks are interrupted by surrounding tests/mocks.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const enrichment = await prisma.channelEnrichment.findUnique({
      where: {
        channelId: input.channelId,
      },
      select: {
        retryCount: true,
        status: true,
      },
    });

    if (
      !enrichment ||
      !failureEligibleStatuses.includes(enrichment.status)
    ) {
      return;
    }

    const retryCount = enrichment.retryCount + 1;
    const updated = await prisma.channelEnrichment.updateMany({
      where: {
        channelId: input.channelId,
        retryCount: enrichment.retryCount,
        status: enrichment.status,
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
      status: true,
    },
  });

  if (
    !enrichment ||
    !failureEligibleStatuses.includes(enrichment.status)
  ) {
    return;
  }

  const retryCount = enrichment.retryCount + 1;

  await prisma.channelEnrichment.updateMany({
    where: {
      channelId: input.channelId,
      retryCount: enrichment.retryCount,
      status: enrichment.status,
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
  aiStaleAfterDays?: number;
  youtubeStaleAfterDays?: number;
  maxRetryCount?: number;
  processingTimeoutMs?: number;
  queuedTimeoutMs?: number;
  now?: Date;
}): Promise<QueueDueChannelLlmEnrichmentsResult> {
  const scannedAt = input.now ?? new Date();
  const batchSize = normalizeContinuousEnrichmentBatchSize(input.batchSize);
  const aiStaleAfterDays = normalizeContinuousEnrichmentStaleDays(
    input.aiStaleAfterDays,
    CHANNEL_ENRICHMENT_STALE_WINDOW_DAYS,
  );
  const youtubeStaleAfterDays = normalizeContinuousEnrichmentStaleDays(
    input.youtubeStaleAfterDays,
    YOUTUBE_CONTEXT_FRESH_WINDOW_DAYS,
  );
  const maxRetryCount = normalizeContinuousEnrichmentMaxRetryCount(input.maxRetryCount);
  const processingTimeoutMs = normalizePositiveDurationMs(
    input.processingTimeoutMs,
    CHANNEL_LLM_ENRICHMENT_DEFAULT_PROCESSING_TIMEOUT_MS,
  );
  const queuedTimeoutMs = normalizePositiveDurationMs(
    input.queuedTimeoutMs,
    CHANNEL_LLM_ENRICHMENT_DEFAULT_QUEUED_TIMEOUT_MS,
  );
  const aiStaleThreshold = new Date(scannedAt.getTime() - aiStaleAfterDays * DAY_IN_MS);
  const youtubeStaleThreshold = new Date(scannedAt.getTime() - youtubeStaleAfterDays * DAY_IN_MS);
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
      staleThreshold: aiStaleThreshold,
      aiStaleThreshold,
      youtubeStaleThreshold,
      queued: 0,
      queuedFull: 0,
      queuedYoutubeOnly: 0,
      skipped: 0,
      failed: 0,
      missingYoutubeCredential: true,
      queuedChannelIds: [],
    };
  }

  const candidates = await listDueChannelLlmEnrichmentCandidates({
    batchSize,
    staleThreshold: aiStaleThreshold,
    processingStaleThreshold,
    queuedStaleThreshold,
    maxRetryCount,
    now: scannedAt,
  });
  let skipped = 0;
  let failed = 0;
  const queuedChannelIds: string[] = [];
  let queuedFull = 0;
  let queuedYoutubeOnly = 0;

  for (const candidate of candidates) {
    const claimed = await claimDueChannelLlmEnrichment({
      candidate,
      requestedAt: scannedAt,
      staleThreshold: aiStaleThreshold,
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
      queuedFull += 1;
    } catch (error) {
      failed += 1;
      await markChannelLlmEnrichmentFailed({
        channelId: candidate.channelId,
        error,
        failedAt: scannedAt,
      });
    }
  }

  const remainingBatchSize = batchSize - candidates.length;
  const youtubeRefreshCandidates = await listDueChannelYoutubeRefreshCandidates({
    batchSize: remainingBatchSize,
    aiStaleThreshold,
    youtubeStaleThreshold,
    processingStaleThreshold,
    queuedStaleThreshold,
    maxRetryCount,
    now: scannedAt,
    excludedChannelIds: candidates.map((candidate) => candidate.channelId),
  });

  for (const candidate of youtubeRefreshCandidates) {
    const claimed = await claimDueChannelYoutubeRefresh({
      candidate,
      requestedAt: scannedAt,
      youtubeStaleThreshold,
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
        mode: "youtube_only",
      });

      queuedChannelIds.push(candidate.channelId);
      queuedYoutubeOnly += 1;
    } catch (error) {
      failed += 1;
      await markChannelYoutubeRefreshFailed({
        channelId: candidate.channelId,
        error,
        failedAt: scannedAt,
      });
    }
  }

  return {
    scannedAt,
    staleThreshold: aiStaleThreshold,
    aiStaleThreshold,
    youtubeStaleThreshold,
    queued: queuedChannelIds.length,
    queuedFull,
    queuedYoutubeOnly,
    skipped,
    failed,
    missingYoutubeCredential: false,
    queuedChannelIds,
  };
}
