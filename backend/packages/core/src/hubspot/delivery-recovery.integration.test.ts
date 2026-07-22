import {
  HubspotDeliveryMode,
  HubspotImportBatchStatus,
  HubspotPushBatchStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type RecoveryModule = typeof import("./delivery-recovery");

integration("HubSpot delivery recovery", () => {
  let prisma: PrismaClient;
  let userId: string;
  let runId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });
    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        hubspot_import_batches,
        run_requests,
        users
      RESTART IDENTITY CASCADE
    `);
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();

    const user = await prisma.user.create({
      data: {
        email: "direct-recovery@example.com",
        passwordHash: "hash",
        role: Role.USER,
        isActive: true,
      },
    });
    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: user.id,
        name: "Direct recovery run",
        query: "stale direct batch",
      },
    });
    userId = user.id;
    runId = run.id;
  });

  afterAll(async () => {
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    await prisma.$disconnect();
  });

  async function loadRecovery(): Promise<RecoveryModule> {
    return import("./delivery-recovery");
  }

  async function seedBatch(input: {
    now: Date;
    status?: HubspotImportBatchStatus;
    deliveryMode?: HubspotDeliveryMode;
    updatedAtOffsetMs?: number;
    nextRetryAt?: Date | null;
    phaseLeaseOwner?: string | null;
    phaseLeaseExpiresAt?: Date | null;
  }): Promise<string> {
    const updatedAt = new Date(
      input.now.getTime() + (input.updatedAtOffsetMs ?? -60_000),
    );
    const batch = await prisma.hubspotImportBatch.create({
      data: {
        requestedByUserId: userId,
        runRequestId: runId,
        fileName: "direct-recovery.csv",
        schemaVersion: "week7-hubspot-import-v2",
        status: input.status ?? HubspotImportBatchStatus.PREPARING,
        deliveryMode: input.deliveryMode ?? HubspotDeliveryMode.DIRECT_OBJECT_API,
        ...(input.nextRetryAt === undefined ? {} : { nextRetryAt: input.nextRetryAt }),
        ...(input.phaseLeaseOwner === undefined
          ? {}
          : { phaseLeaseOwner: input.phaseLeaseOwner }),
        ...(input.phaseLeaseExpiresAt === undefined
          ? {}
          : { phaseLeaseExpiresAt: input.phaseLeaseExpiresAt }),
        createdAt: updatedAt,
        updatedAt,
      },
    });
    return batch.id;
  }

  async function seedPushBatch(input: {
    now: Date;
    status?: HubspotPushBatchStatus;
    updatedAtOffsetMs?: number;
    startedAt?: Date | null;
  }): Promise<string> {
    const updatedAt = new Date(
      input.now.getTime() + (input.updatedAtOffsetMs ?? -60_000),
    );
    const batch = await prisma.hubspotPushBatch.create({
      data: {
        requestedByUserId: userId,
        scopePayload: { type: "selected", channelIds: [] },
        status: input.status ?? HubspotPushBatchStatus.QUEUED,
        ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
        createdAt: updatedAt,
        updatedAt,
      },
    });
    return batch.id;
  }

  it("requeues only stale due direct phases and uses fresh temporary recovery leases", async () => {
    const now = new Date();
    const orphanedBatchId = await seedBatch({ now });
    const expiredBatchId = await seedBatch({
      now,
      status: HubspotImportBatchStatus.PROCESSING,
      phaseLeaseOwner: "expired-worker",
      phaseLeaseExpiresAt: new Date(now.getTime() - 1_000),
    });
    await seedBatch({
      now,
      status: HubspotImportBatchStatus.SUBMITTING,
      phaseLeaseOwner: "active-worker",
      phaseLeaseExpiresAt: new Date(now.getTime() + 60_000),
    });
    await seedBatch({ now, updatedAtOffsetMs: -5_000 });
    await seedBatch({
      now,
      status: HubspotImportBatchStatus.SUBMITTED,
      nextRetryAt: new Date(now.getTime() + 60_000),
    });
    await seedBatch({ now, deliveryMode: HubspotDeliveryMode.CSV_FALLBACK });
    await seedBatch({ now, status: HubspotImportBatchStatus.COMPLETED });
    const recovery = await loadRecovery();
    const observedOwners = new Set<string>();
    const enqueue = vi.fn(async (payload: { importBatchId: string }, options: unknown) => {
      const claimed = await prisma.hubspotImportBatch.findUniqueOrThrow({
        where: { id: payload.importBatchId },
      });
      expect(claimed.phaseLeaseOwner).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(claimed.phaseLeaseExpiresAt).toEqual(
        new Date(now.getTime() + recovery.HUBSPOT_DIRECT_IMPORT_RECOVERY_LEASE_MS),
      );
      observedOwners.add(claimed.phaseLeaseOwner!);
      expect(options).toEqual({
        startAfterSeconds: recovery.HUBSPOT_DIRECT_IMPORT_RECOVERY_ENQUEUE_DELAY_SECONDS,
      });
    });

    const result = await recovery.recoverStaleHubspotDirectImportBatches({
      now,
      enqueue,
    });

    expect(result).toEqual({
      candidates: 2,
      claimed: 2,
      requeued: 2,
      enqueueFailed: 0,
      ownershipLost: 0,
    });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls.map(([payload]) => payload.importBatchId).sort()).toEqual(
      [expiredBatchId, orphanedBatchId].sort(),
    );
    expect(observedOwners.size).toBe(2);
    for (const batchId of [orphanedBatchId, expiredBatchId]) {
      expect(
        await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } }),
      ).toMatchObject({
        phaseLeaseOwner: null,
        phaseLeaseExpiresAt: null,
        updatedAt: now,
      });
    }

    await expect(recovery.recoverStaleHubspotDirectImportBatches({
      now,
      enqueue,
    })).resolves.toMatchObject({ candidates: 0, requeued: 0 });
  });

  it("persists enqueue failure with an owner-fenced retry delay and later recovers it", async () => {
    const now = new Date();
    const batchId = await seedBatch({ now });
    const recovery = await loadRecovery();
    let firstLeaseOwner: string | null = null;

    const first = await recovery.recoverStaleHubspotDirectImportBatches({
      now,
      enqueue: async (payload) => {
        firstLeaseOwner = (await prisma.hubspotImportBatch.findUniqueOrThrow({
          where: { id: payload.importBatchId },
        })).phaseLeaseOwner;
        throw new Error("pg-boss unavailable");
      },
    });

    expect(first).toMatchObject({ claimed: 1, enqueueFailed: 1, ownershipLost: 0 });
    expect(firstLeaseOwner).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } }))
      .toMatchObject({
        phaseLeaseOwner: null,
        phaseLeaseExpiresAt: null,
        nextRetryAt: new Date(
          now.getTime() + recovery.HUBSPOT_DIRECT_IMPORT_RECOVERY_FAILURE_RETRY_MS,
        ),
        lastError: "HubSpot direct-sync queue recovery failed: pg-boss unavailable",
        updatedAt: now,
      });

    const retryNow = new Date(now.getTime() + 61_000);
    let secondLeaseOwner: string | null = null;
    const second = await recovery.recoverStaleHubspotDirectImportBatches({
      now: retryNow,
      enqueue: async (payload) => {
        secondLeaseOwner = (await prisma.hubspotImportBatch.findUniqueOrThrow({
          where: { id: payload.importBatchId },
        })).phaseLeaseOwner;
      },
    });
    expect(second).toMatchObject({ claimed: 1, requeued: 1, enqueueFailed: 0 });
    expect(secondLeaseOwner).not.toBe(firstLeaseOwner);
  });

  it("does not clear or overwrite a lease that changes ownership during enqueue", async () => {
    const now = new Date();
    const batchId = await seedBatch({ now });
    const recovery = await loadRecovery();

    const result = await recovery.recoverStaleHubspotDirectImportBatches({
      now,
      enqueue: async () => {
        await prisma.hubspotImportBatch.update({
          where: { id: batchId },
          data: {
            phaseLeaseOwner: "successor-worker",
            phaseLeaseExpiresAt: new Date(now.getTime() + 60_000),
            lastError: "successor owns this batch",
          },
        });
        throw new Error("late recovery enqueue failure");
      },
    });

    expect(result).toMatchObject({
      claimed: 1,
      enqueueFailed: 1,
      ownershipLost: 1,
    });
    expect(await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } }))
      .toMatchObject({
        phaseLeaseOwner: "successor-worker",
        phaseLeaseExpiresAt: new Date(now.getTime() + 60_000),
        nextRetryAt: null,
        lastError: "successor owns this batch",
      });
  });

  it("atomically fences and requeues stale CSV fallback deliveries across monitors", async () => {
    const now = new Date();
    const queuedBatchId = await seedBatch({
      now,
      deliveryMode: HubspotDeliveryMode.CSV_FALLBACK,
      status: HubspotImportBatchStatus.QUEUED,
    });
    const expiredRunningBatchId = await seedBatch({
      now,
      deliveryMode: HubspotDeliveryMode.CSV_FALLBACK,
      status: HubspotImportBatchStatus.RUNNING,
      updatedAtOffsetMs: -5_000,
      phaseLeaseOwner: "expired-csv-worker",
      phaseLeaseExpiresAt: new Date(now.getTime() - 1_000),
    });
    await seedBatch({
      now,
      deliveryMode: HubspotDeliveryMode.CSV_FALLBACK,
      status: HubspotImportBatchStatus.RUNNING,
      updatedAtOffsetMs: -20 * 60_000,
      phaseLeaseOwner: "active-csv-worker",
      phaseLeaseExpiresAt: new Date(now.getTime() + 60_000),
    });
    await seedBatch({
      now,
      deliveryMode: HubspotDeliveryMode.CSV_FALLBACK,
      status: HubspotImportBatchStatus.QUEUED,
      updatedAtOffsetMs: -5_000,
    });
    const recovery = await loadRecovery();
    const enqueue = vi.fn(async (payload: { importBatchId: string }) => {
      const claimed = await prisma.hubspotImportBatch.findUniqueOrThrow({
        where: { id: payload.importBatchId },
      });
      expect(claimed.status).toBe(HubspotImportBatchStatus.QUEUED);
      expect(claimed.startedAt).toBeNull();
      expect(claimed.phaseLeaseOwner).toMatch(/^[0-9a-f-]{36}$/i);
    });

    const results = await Promise.all([
      recovery.recoverStaleHubspotCsvFallbackBatches({ now, enqueue }),
      recovery.recoverStaleHubspotCsvFallbackBatches({ now, enqueue }),
    ]);

    expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(2);
    expect(results.reduce((sum, result) => sum + result.requeued, 0)).toBe(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls.map(([payload]) => payload.importBatchId).sort()).toEqual(
      [expiredRunningBatchId, queuedBatchId].sort(),
    );
    for (const batchId of [queuedBatchId, expiredRunningBatchId]) {
      expect(await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } }))
        .toMatchObject({
          status: HubspotImportBatchStatus.QUEUED,
          phaseLeaseOwner: null,
          phaseLeaseExpiresAt: null,
          startedAt: null,
          lastError: null,
          updatedAt: now,
        });
    }
    await expect(prisma.hubspotImportBatch.updateMany({
      where: {
        id: expiredRunningBatchId,
        status: HubspotImportBatchStatus.RUNNING,
        phaseLeaseOwner: "expired-csv-worker",
      },
      data: { lastError: "stale CSV execution wrote after takeover" },
    })).resolves.toMatchObject({ count: 0 });
  });

  it("leaves a CSV recovery enqueue failure queued, fenced, and retryable", async () => {
    const now = new Date();
    const batchId = await seedBatch({
      now,
      deliveryMode: HubspotDeliveryMode.CSV_FALLBACK,
      status: HubspotImportBatchStatus.RUNNING,
      updatedAtOffsetMs: -20 * 60_000,
      phaseLeaseOwner: "abandoned-csv-worker",
      phaseLeaseExpiresAt: null,
    });
    const recovery = await loadRecovery();

    const result = await recovery.recoverStaleHubspotCsvFallbackBatches({
      now,
      enqueue: async () => {
        throw new Error("CSV queue unavailable");
      },
    });

    expect(result).toMatchObject({ claimed: 1, enqueueFailed: 1, ownershipLost: 0 });
    expect(await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } }))
      .toMatchObject({
        status: HubspotImportBatchStatus.QUEUED,
        phaseLeaseOwner: null,
        phaseLeaseExpiresAt: null,
        startedAt: null,
        nextRetryAt: new Date(
          now.getTime() + recovery.HUBSPOT_CSV_FALLBACK_RECOVERY_FAILURE_RETRY_MS,
        ),
        lastError: "HubSpot CSV fallback queue recovery failed: CSV queue unavailable",
        updatedAt: now,
      });
  });

  it("fences stale legacy pushes and keeps enqueue failures durably recoverable", async () => {
    const now = new Date();
    const queuedBatchId = await seedPushBatch({ now });
    const staleStartedAt = new Date(now.getTime() - 20 * 60_000);
    const runningBatchId = await seedPushBatch({
      now,
      status: HubspotPushBatchStatus.RUNNING,
      updatedAtOffsetMs: -20 * 60_000,
      startedAt: staleStartedAt,
    });
    await seedPushBatch({ now, updatedAtOffsetMs: -5_000 });
    await seedPushBatch({
      now,
      status: HubspotPushBatchStatus.RUNNING,
      updatedAtOffsetMs: -5_000,
      startedAt: new Date(now.getTime() - 5_000),
    });
    const recovery = await loadRecovery();
    const enqueue = vi.fn(async (payload: { pushBatchId: string }) => {
      const claimed = await prisma.hubspotPushBatch.findUniqueOrThrow({
        where: { id: payload.pushBatchId },
      });
      expect(claimed.status).toBe(HubspotPushBatchStatus.QUEUED);
      expect(claimed.startedAt).toBeNull();
      expect(claimed.updatedAt).toEqual(now);
    });

    const results = await Promise.all([
      recovery.recoverStaleLegacyHubspotPushBatches({ now, enqueue }),
      recovery.recoverStaleLegacyHubspotPushBatches({ now, enqueue }),
    ]);
    expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(2);
    expect(results.reduce((sum, result) => sum + result.requeued, 0)).toBe(2);
    expect(enqueue.mock.calls.map(([payload]) => payload.pushBatchId).sort()).toEqual(
      [queuedBatchId, runningBatchId].sort(),
    );
    await expect(prisma.hubspotPushBatch.updateMany({
      where: {
        id: runningBatchId,
        status: HubspotPushBatchStatus.RUNNING,
        startedAt: staleStartedAt,
      },
      data: { lastError: "stale push execution wrote after takeover" },
    })).resolves.toMatchObject({ count: 0 });

    const failedBatchId = await seedPushBatch({
      now,
      updatedAtOffsetMs: -60_000,
    });
    const failed = await recovery.recoverStaleLegacyHubspotPushBatches({
      now,
      enqueue: async (payload) => {
        if (payload.pushBatchId === failedBatchId) {
          throw new Error("push queue unavailable");
        }
      },
    });
    expect(failed).toMatchObject({ claimed: 1, enqueueFailed: 1, ownershipLost: 0 });
    expect(await prisma.hubspotPushBatch.findUniqueOrThrow({ where: { id: failedBatchId } }))
      .toMatchObject({
        status: HubspotPushBatchStatus.QUEUED,
        startedAt: null,
        completedAt: null,
        lastError: "HubSpot push queue recovery failed: push queue unavailable",
        updatedAt: now,
      });
  });
});
