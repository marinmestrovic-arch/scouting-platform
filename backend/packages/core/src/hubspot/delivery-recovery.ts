import { randomUUID } from "node:crypto";

import {
  HubspotDeliveryMode as PrismaHubspotDeliveryMode,
  HubspotImportBatchStatus as PrismaHubspotImportBatchStatus,
  HubspotPushBatchStatus as PrismaHubspotPushBatchStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@scouting-platform/db";

export const HUBSPOT_DIRECT_IMPORT_RECOVERY_STALE_AFTER_MS = 30 * 1_000;
export const HUBSPOT_DIRECT_IMPORT_RECOVERY_LEASE_MS = 2 * 60 * 1_000;
export const HUBSPOT_DIRECT_IMPORT_RECOVERY_FAILURE_RETRY_MS = 30 * 1_000;
export const HUBSPOT_DIRECT_IMPORT_RECOVERY_BATCH_SIZE = 25;
export const HUBSPOT_DIRECT_IMPORT_RECOVERY_ENQUEUE_DELAY_SECONDS = 2;
export const HUBSPOT_CSV_FALLBACK_RECOVERY_QUEUED_AFTER_MS = 30 * 1_000;
export const HUBSPOT_CSV_FALLBACK_RECOVERY_RUNNING_TIMEOUT_MS = 15 * 60 * 1_000;
export const HUBSPOT_CSV_FALLBACK_RECOVERY_LEASE_MS = 2 * 60 * 1_000;
export const HUBSPOT_CSV_FALLBACK_RECOVERY_FAILURE_RETRY_MS = 30 * 1_000;
export const HUBSPOT_LEGACY_PUSH_RECOVERY_QUEUED_AFTER_MS = 30 * 1_000;
export const HUBSPOT_LEGACY_PUSH_RECOVERY_RUNNING_TIMEOUT_MS = 15 * 60 * 1_000;
export const HUBSPOT_DELIVERY_RECOVERY_BATCH_SIZE = 25;
export const HUBSPOT_DELIVERY_RECOVERY_ENQUEUE_DELAY_SECONDS = 2;

const RECOVERABLE_DIRECT_IMPORT_STATUSES = [
  PrismaHubspotImportBatchStatus.QUEUED,
  PrismaHubspotImportBatchStatus.PREPARING,
  PrismaHubspotImportBatchStatus.SUBMITTING,
  PrismaHubspotImportBatchStatus.SUBMITTED,
  PrismaHubspotImportBatchStatus.PROCESSING,
] as const;

export type HubspotDeliveryRecoveryStats = Readonly<{
  candidates: number;
  claimed: number;
  requeued: number;
  enqueueFailed: number;
  ownershipLost: number;
}>;

export type HubspotDirectImportRecoveryResult = HubspotDeliveryRecoveryStats;

type DirectImportRecoveryPayload = Readonly<{
  importBatchId: string;
  requestedByUserId: string;
}>;

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Restores a durable queue delivery for a direct-sync phase that has no live
 * phase lease. The temporary recovery lease makes multiple worker processes
 * safe: only one monitor can enqueue a given stale batch, and every cleanup or
 * failure write is fenced by the fresh lease owner token.
 */
export async function recoverStaleHubspotDirectImportBatches(input: {
  enqueue: (
    payload: DirectImportRecoveryPayload,
    options: Readonly<{ startAfterSeconds: number }>,
  ) => Promise<void>;
  now?: Date;
  staleAfterMs?: number;
  recoveryLeaseMs?: number;
  failureRetryAfterMs?: number;
  batchSize?: number;
  enqueueDelaySeconds?: number;
}): Promise<HubspotDirectImportRecoveryResult> {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs
    ?? HUBSPOT_DIRECT_IMPORT_RECOVERY_STALE_AFTER_MS;
  const recoveryLeaseMs = input.recoveryLeaseMs
    ?? HUBSPOT_DIRECT_IMPORT_RECOVERY_LEASE_MS;
  const failureRetryAfterMs = input.failureRetryAfterMs
    ?? HUBSPOT_DIRECT_IMPORT_RECOVERY_FAILURE_RETRY_MS;
  const batchSize = input.batchSize ?? HUBSPOT_DIRECT_IMPORT_RECOVERY_BATCH_SIZE;
  const enqueueDelaySeconds = input.enqueueDelaySeconds
    ?? HUBSPOT_DIRECT_IMPORT_RECOVERY_ENQUEUE_DELAY_SECONDS;
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const candidates = await prisma.hubspotImportBatch.findMany({
    where: {
      deliveryMode: PrismaHubspotDeliveryMode.DIRECT_OBJECT_API,
      status: { in: [...RECOVERABLE_DIRECT_IMPORT_STATUSES] },
      updatedAt: { lte: staleBefore },
      AND: [
        { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
        {
          OR: [
            { phaseLeaseOwner: null },
            { phaseLeaseExpiresAt: null },
            { phaseLeaseExpiresAt: { lte: now } },
          ],
        },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(batchSize, 100)),
    select: {
      id: true,
      requestedByUserId: true,
    },
  });

  let claimed = 0;
  let requeued = 0;
  let enqueueFailed = 0;
  let ownershipLost = 0;

  for (const candidate of candidates) {
    const recoveryLeaseOwner = randomUUID();
    const claimedBatch = await prisma.hubspotImportBatch.updateMany({
      where: {
        id: candidate.id,
        requestedByUserId: candidate.requestedByUserId,
        deliveryMode: PrismaHubspotDeliveryMode.DIRECT_OBJECT_API,
        status: { in: [...RECOVERABLE_DIRECT_IMPORT_STATUSES] },
        updatedAt: { lte: staleBefore },
        AND: [
          { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
          {
            OR: [
              { phaseLeaseOwner: null },
              { phaseLeaseExpiresAt: null },
              { phaseLeaseExpiresAt: { lte: now } },
            ],
          },
        ],
      },
      data: {
        phaseLeaseOwner: recoveryLeaseOwner,
        phaseLeaseExpiresAt: new Date(now.getTime() + recoveryLeaseMs),
        updatedAt: now,
      },
    });
    if (claimedBatch.count !== 1) {
      continue;
    }
    claimed += 1;

    const payload = {
      importBatchId: candidate.id,
      requestedByUserId: candidate.requestedByUserId,
    };
    try {
      await input.enqueue(payload, { startAfterSeconds: enqueueDelaySeconds });
      requeued += 1;
      const released = await prisma.hubspotImportBatch.updateMany({
        where: {
          id: candidate.id,
          phaseLeaseOwner: recoveryLeaseOwner,
        },
        data: {
          phaseLeaseOwner: null,
          phaseLeaseExpiresAt: null,
          updatedAt: now,
        },
      });
      if (released.count !== 1) {
        ownershipLost += 1;
      }
    } catch (error) {
      enqueueFailed += 1;
      const persisted = await prisma.hubspotImportBatch.updateMany({
        where: {
          id: candidate.id,
          phaseLeaseOwner: recoveryLeaseOwner,
        },
        data: {
          phaseLeaseOwner: null,
          phaseLeaseExpiresAt: null,
          nextRetryAt: new Date(now.getTime() + failureRetryAfterMs),
          lastError: `HubSpot direct-sync queue recovery failed: ${safeMessage(error)}`
            .slice(0, 2_000),
          updatedAt: now,
        },
      });
      if (persisted.count !== 1) {
        ownershipLost += 1;
      }
    }
  }

  return {
    candidates: candidates.length,
    claimed,
    requeued,
    enqueueFailed,
    ownershipLost,
  };
}

function csvFallbackCandidateWhere(input: {
  now: Date;
  queuedBefore: Date;
  runningBefore: Date;
}): Prisma.HubspotImportBatchWhereInput {
  return {
    deliveryMode: PrismaHubspotDeliveryMode.CSV_FALLBACK,
    AND: [
      { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: input.now } }] },
      {
        OR: [
          {
            status: PrismaHubspotImportBatchStatus.QUEUED,
            updatedAt: { lte: input.queuedBefore },
            OR: [
              { phaseLeaseOwner: null },
              { phaseLeaseExpiresAt: null },
              { phaseLeaseExpiresAt: { lte: input.now } },
            ],
          },
          {
            status: PrismaHubspotImportBatchStatus.RUNNING,
            OR: [
              { phaseLeaseExpiresAt: { lte: input.now } },
              {
                phaseLeaseExpiresAt: null,
                updatedAt: { lte: input.runningBefore },
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Resets an abandoned CSV fallback execution to QUEUED before enqueueing it.
 * Replacing the phase owner and RUNNING status atomically fences any suspended
 * execution before a replacement job can be delivered.
 */
export async function recoverStaleHubspotCsvFallbackBatches(input: {
  enqueue: (
    payload: DirectImportRecoveryPayload,
    options: Readonly<{ startAfterSeconds: number }>,
  ) => Promise<void>;
  now?: Date;
  queuedRecoveryAfterMs?: number;
  runningTimeoutMs?: number;
  recoveryLeaseMs?: number;
  failureRetryAfterMs?: number;
  batchSize?: number;
  enqueueDelaySeconds?: number;
}): Promise<HubspotDeliveryRecoveryStats> {
  const now = input.now ?? new Date();
  const queuedBefore = new Date(
    now.getTime()
      - (input.queuedRecoveryAfterMs ?? HUBSPOT_CSV_FALLBACK_RECOVERY_QUEUED_AFTER_MS),
  );
  const runningBefore = new Date(
    now.getTime()
      - (input.runningTimeoutMs ?? HUBSPOT_CSV_FALLBACK_RECOVERY_RUNNING_TIMEOUT_MS),
  );
  const recoveryLeaseMs = input.recoveryLeaseMs
    ?? HUBSPOT_CSV_FALLBACK_RECOVERY_LEASE_MS;
  const failureRetryAfterMs = input.failureRetryAfterMs
    ?? HUBSPOT_CSV_FALLBACK_RECOVERY_FAILURE_RETRY_MS;
  const enqueueDelaySeconds = input.enqueueDelaySeconds
    ?? HUBSPOT_DELIVERY_RECOVERY_ENQUEUE_DELAY_SECONDS;
  const candidateWhere = csvFallbackCandidateWhere({ now, queuedBefore, runningBefore });
  const candidates = await prisma.hubspotImportBatch.findMany({
    where: candidateWhere,
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(
      1,
      Math.min(input.batchSize ?? HUBSPOT_DELIVERY_RECOVERY_BATCH_SIZE, 100),
    ),
    select: {
      id: true,
      requestedByUserId: true,
    },
  });

  let claimed = 0;
  let requeued = 0;
  let enqueueFailed = 0;
  let ownershipLost = 0;

  for (const candidate of candidates) {
    const recoveryLeaseOwner = randomUUID();
    const claimedBatch = await prisma.hubspotImportBatch.updateMany({
      where: {
        id: candidate.id,
        requestedByUserId: candidate.requestedByUserId,
        ...candidateWhere,
      },
      data: {
        status: PrismaHubspotImportBatchStatus.QUEUED,
        phaseLeaseOwner: recoveryLeaseOwner,
        phaseLeaseExpiresAt: new Date(now.getTime() + recoveryLeaseMs),
        nextRetryAt: null,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
      },
    });
    if (claimedBatch.count !== 1) {
      continue;
    }
    claimed += 1;

    const payload = {
      importBatchId: candidate.id,
      requestedByUserId: candidate.requestedByUserId,
    };
    try {
      await input.enqueue(payload, { startAfterSeconds: enqueueDelaySeconds });
      requeued += 1;
      const released = await prisma.hubspotImportBatch.updateMany({
        where: {
          id: candidate.id,
          status: PrismaHubspotImportBatchStatus.QUEUED,
          phaseLeaseOwner: recoveryLeaseOwner,
        },
        data: {
          phaseLeaseOwner: null,
          phaseLeaseExpiresAt: null,
          lastError: null,
          updatedAt: now,
        },
      });
      if (released.count !== 1) {
        ownershipLost += 1;
      }
    } catch (error) {
      enqueueFailed += 1;
      const persisted = await prisma.hubspotImportBatch.updateMany({
        where: {
          id: candidate.id,
          status: PrismaHubspotImportBatchStatus.QUEUED,
          phaseLeaseOwner: recoveryLeaseOwner,
        },
        data: {
          phaseLeaseOwner: null,
          phaseLeaseExpiresAt: null,
          nextRetryAt: new Date(now.getTime() + failureRetryAfterMs),
          lastError: `HubSpot CSV fallback queue recovery failed: ${safeMessage(error)}`
            .slice(0, 2_000),
          updatedAt: now,
        },
      });
      if (persisted.count !== 1) {
        ownershipLost += 1;
      }
    }
  }

  return {
    candidates: candidates.length,
    claimed,
    requeued,
    enqueueFailed,
    ownershipLost,
  };
}

function legacyPushCandidateWhere(input: {
  queuedBefore: Date;
  runningBefore: Date;
}): Prisma.HubspotPushBatchWhereInput {
  return {
    OR: [
      {
        status: PrismaHubspotPushBatchStatus.QUEUED,
        updatedAt: { lte: input.queuedBefore },
      },
      {
        status: PrismaHubspotPushBatchStatus.RUNNING,
        updatedAt: { lte: input.runningBefore },
      },
    ],
  };
}

/**
 * Requeues legacy push deliveries after atomically replacing RUNNING with
 * QUEUED and clearing startedAt. Legacy writes are fenced by both values, so a
 * suspended execution cannot commit after the monitor claims the batch.
 */
export async function recoverStaleLegacyHubspotPushBatches(input: {
  enqueue: (
    payload: Readonly<{ pushBatchId: string; requestedByUserId: string }>,
    options: Readonly<{ startAfterSeconds: number }>,
  ) => Promise<void>;
  now?: Date;
  queuedRecoveryAfterMs?: number;
  runningTimeoutMs?: number;
  batchSize?: number;
  enqueueDelaySeconds?: number;
}): Promise<HubspotDeliveryRecoveryStats> {
  const now = input.now ?? new Date();
  const queuedBefore = new Date(
    now.getTime()
      - (input.queuedRecoveryAfterMs ?? HUBSPOT_LEGACY_PUSH_RECOVERY_QUEUED_AFTER_MS),
  );
  const runningBefore = new Date(
    now.getTime()
      - (input.runningTimeoutMs ?? HUBSPOT_LEGACY_PUSH_RECOVERY_RUNNING_TIMEOUT_MS),
  );
  const enqueueDelaySeconds = input.enqueueDelaySeconds
    ?? HUBSPOT_DELIVERY_RECOVERY_ENQUEUE_DELAY_SECONDS;
  const candidateWhere = legacyPushCandidateWhere({ queuedBefore, runningBefore });
  const candidates = await prisma.hubspotPushBatch.findMany({
    where: candidateWhere,
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(
      1,
      Math.min(input.batchSize ?? HUBSPOT_DELIVERY_RECOVERY_BATCH_SIZE, 100),
    ),
    select: {
      id: true,
      requestedByUserId: true,
    },
  });

  let claimed = 0;
  let requeued = 0;
  let enqueueFailed = 0;
  let ownershipLost = 0;

  for (const candidate of candidates) {
    const claimedBatch = await prisma.hubspotPushBatch.updateMany({
      where: {
        id: candidate.id,
        requestedByUserId: candidate.requestedByUserId,
        ...candidateWhere,
      },
      data: {
        status: PrismaHubspotPushBatchStatus.QUEUED,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
      },
    });
    if (claimedBatch.count !== 1) {
      continue;
    }
    claimed += 1;

    const payload = {
      pushBatchId: candidate.id,
      requestedByUserId: candidate.requestedByUserId,
    };
    try {
      await input.enqueue(payload, { startAfterSeconds: enqueueDelaySeconds });
      requeued += 1;
      const released = await prisma.hubspotPushBatch.updateMany({
        where: {
          id: candidate.id,
          status: PrismaHubspotPushBatchStatus.QUEUED,
          startedAt: null,
          updatedAt: now,
        },
        data: {
          lastError: null,
          updatedAt: now,
        },
      });
      if (released.count !== 1) {
        ownershipLost += 1;
      }
    } catch (error) {
      enqueueFailed += 1;
      const persisted = await prisma.hubspotPushBatch.updateMany({
        where: {
          id: candidate.id,
          status: PrismaHubspotPushBatchStatus.QUEUED,
          startedAt: null,
          updatedAt: now,
        },
        data: {
          lastError: `HubSpot push queue recovery failed: ${safeMessage(error)}`.slice(0, 2_000),
          updatedAt: now,
        },
      });
      if (persisted.count !== 1) {
        ownershipLost += 1;
      }
    }
  }

  return {
    candidates: candidates.length,
    claimed,
    requeued,
    enqueueFailed,
    ownershipLost,
  };
}

export type HubspotDeliveryRecoveryResult = Readonly<{
  directImports: HubspotDeliveryRecoveryStats;
  csvFallbackImports: HubspotDeliveryRecoveryStats;
  legacyPushes: HubspotDeliveryRecoveryStats;
}>;

export async function recoverStaleHubspotDeliveries(input: {
  enqueueImport: (
    payload: DirectImportRecoveryPayload,
    options: Readonly<{ startAfterSeconds: number }>,
  ) => Promise<void>;
  enqueuePush: (
    payload: Readonly<{ pushBatchId: string; requestedByUserId: string }>,
    options: Readonly<{ startAfterSeconds: number }>,
  ) => Promise<void>;
}): Promise<HubspotDeliveryRecoveryResult> {
  const [directImports, csvFallbackImports, legacyPushes] = await Promise.all([
    recoverStaleHubspotDirectImportBatches({ enqueue: input.enqueueImport }),
    recoverStaleHubspotCsvFallbackBatches({ enqueue: input.enqueueImport }),
    recoverStaleLegacyHubspotPushBatches({ enqueue: input.enqueuePush }),
  ]);
  return { directImports, csvFallbackImports, legacyPushes };
}
