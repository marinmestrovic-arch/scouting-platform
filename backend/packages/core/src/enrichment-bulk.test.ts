import { ChannelEnrichmentStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  enqueueChannelLlmJobsMock,
  enqueueJobMock,
  listAllChannelIdsForCatalogFiltersMock,
  prismaMock,
  withDbTransactionMock,
} = vi.hoisted(() => {
  const prisma = {
    userProviderCredential: {
      findUnique: vi.fn(),
    },
    channel: {
      findMany: vi.fn(),
    },
    channelEnrichment: {
      updateMany: vi.fn(),
      updateManyAndReturn: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    auditEvent: {
      createMany: vi.fn(),
    },
  };

  return {
    enqueueChannelLlmJobsMock: vi.fn(),
    enqueueJobMock: vi.fn(),
    listAllChannelIdsForCatalogFiltersMock: vi.fn(),
    prismaMock: prisma,
    withDbTransactionMock: vi.fn(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    ),
  };
});

vi.mock("@scouting-platform/db", () => ({
  prisma: prismaMock,
  withDbTransaction: withDbTransactionMock,
}));

vi.mock("./channels", () => ({
  getChannelById: vi.fn(),
  listAllChannelIdsForCatalogFilters: listAllChannelIdsForCatalogFiltersMock,
}));

vi.mock("./queue", () => ({
  enqueueChannelLlmJobs: enqueueChannelLlmJobsMock,
  enqueueJob: enqueueJobMock,
}));

import {
  cancelBulkChannelLlmEnrichment,
  requestBulkChannelLlmEnrichment,
} from "./enrichment";

const requestedByUserId = "11111111-1111-4111-8111-111111111111";
const missingChannelId = "22222222-2222-4222-8222-222222222222";
const failedChannelId = "33333333-3333-4333-8333-333333333333";
const queuedChannelId = "44444444-4444-4444-8444-444444444444";
const completedChannelId = "55555555-5555-4555-8555-555555555555";

describe("bulk channel LLM enrichment requests", () => {
  beforeEach(() => {
    // Freeze time so "completed" channels with fixed dates don't drift into the stale window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T00:00:00.000Z"));
    vi.clearAllMocks();
    prismaMock.userProviderCredential.findUnique.mockResolvedValue({ id: "credential-id" });
    prismaMock.channelEnrichment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelEnrichment.createMany.mockResolvedValue({ count: 1 });
    prismaMock.auditEvent.createMany.mockResolvedValue({ count: 2 });
    enqueueJobMock.mockResolvedValue(undefined);
    enqueueChannelLlmJobsMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues all matching non-active channels and skips already queued work", async () => {
    listAllChannelIdsForCatalogFiltersMock.mockResolvedValue([
      missingChannelId,
      failedChannelId,
      queuedChannelId,
      completedChannelId,
    ]);
    prismaMock.channel.findMany.mockResolvedValue([
      {
        id: missingChannelId,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        enrichment: null,
      },
      {
        id: failedChannelId,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        enrichment: {
          status: ChannelEnrichmentStatus.FAILED,
          completedAt: null,
          lastEnrichedAt: null,
        },
      },
      {
        id: queuedChannelId,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        enrichment: {
          status: ChannelEnrichmentStatus.QUEUED,
          completedAt: null,
          lastEnrichedAt: null,
        },
      },
      {
        id: completedChannelId,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        enrichment: {
          status: ChannelEnrichmentStatus.COMPLETED,
          completedAt: new Date("2026-05-01T00:00:00.000Z"),
          lastEnrichedAt: new Date("2026-05-01T00:00:00.000Z"),
        },
      },
    ]);

    const result = await requestBulkChannelLlmEnrichment({
      requestedByUserId,
      filters: {
        query: "space",
      },
    });

    expect(result).toEqual({
      requestedCount: 4,
      queuedCount: 2,
      alreadyQueuedCount: 2,
      failedCount: 0,
    });
    expect(prismaMock.channelEnrichment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channelId: {
            in: [failedChannelId],
          },
        },
      }),
    );
    expect(prismaMock.channelEnrichment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            channelId: missingChannelId,
            requestedByUserId,
            status: ChannelEnrichmentStatus.QUEUED,
          }),
        ],
      }),
    );
    expect(enqueueChannelLlmJobsMock).toHaveBeenCalledWith(
      [
        { channelId: missingChannelId, requestedByUserId },
        { channelId: failedChannelId, requestedByUserId },
      ],
      { priority: 10 },
    );
  });

  it("requires a YouTube credential before queueing bulk enrichment", async () => {
    listAllChannelIdsForCatalogFiltersMock.mockResolvedValue([missingChannelId]);
    prismaMock.userProviderCredential.findUnique.mockResolvedValue(null);

    await expect(
      requestBulkChannelLlmEnrichment({
        requestedByUserId,
        filters: {},
      }),
    ).rejects.toMatchObject({
      code: "YOUTUBE_KEY_REQUIRED",
      status: 400,
    });

    expect(withDbTransactionMock).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
    expect(enqueueChannelLlmJobsMock).not.toHaveBeenCalled();
  });

  it("bulk inserts in chunks of 100 and counts a failed chunk accurately", async () => {
    const channelIds = Array.from({ length: 201 }, (_, index) =>
      `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    );
    listAllChannelIdsForCatalogFiltersMock.mockResolvedValue(channelIds);
    prismaMock.channel.findMany.mockResolvedValue(channelIds.map((id) => ({
      id,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      enrichment: null,
    })));
    prismaMock.channelEnrichment.findUnique.mockResolvedValue(null);
    enqueueChannelLlmJobsMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("bulk insert failed"))
      .mockResolvedValueOnce(undefined);

    const result = await requestBulkChannelLlmEnrichment({
      requestedByUserId,
      filters: {},
    });

    expect(enqueueChannelLlmJobsMock).toHaveBeenCalledTimes(3);
    expect(enqueueChannelLlmJobsMock.mock.calls.map(([payloads]) => payloads.length)).toEqual([
      100,
      100,
      1,
    ]);
    expect(enqueueChannelLlmJobsMock.mock.calls.every(([, options]) =>
      options.priority === 10)).toBe(true);
    expect(result).toEqual({
      requestedCount: 201,
      queuedCount: 101,
      alreadyQueuedCount: 0,
      failedCount: 100,
    });
  });
});

describe("bulk channel LLM enrichment cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.channelEnrichment.findMany.mockResolvedValue([
      { channelId: queuedChannelId, status: ChannelEnrichmentStatus.QUEUED },
      { channelId: completedChannelId, status: ChannelEnrichmentStatus.RUNNING },
    ]);
    prismaMock.channelEnrichment.updateManyAndReturn.mockResolvedValue([
      { channelId: queuedChannelId },
      { channelId: completedChannelId },
    ]);
    prismaMock.auditEvent.createMany.mockResolvedValue({ count: 2 });
  });

  it("cancels selected active enrichments and audits exact transitions", async () => {
    const result = await cancelBulkChannelLlmEnrichment({
      actorUserId: requestedByUserId,
      scope: {
        type: "selected",
        channelIds: [queuedChannelId, completedChannelId, failedChannelId],
      },
    });

    expect(result).toEqual({
      requestedCount: 3,
      cancelledCount: 2,
      notActiveCount: 1,
    });
    expect(prismaMock.channelEnrichment.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ChannelEnrichmentStatus.CANCELLED,
          lastError: null,
          nextRetryAt: null,
        }),
      }),
    );
    expect(prismaMock.auditEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          actorUserId: requestedByUserId,
          action: "channel.enrichment.cancelled",
          entityId: queuedChannelId,
          metadata: { previousStatus: "queued", bulk: true },
        }),
        expect.objectContaining({
          actorUserId: requestedByUserId,
          action: "channel.enrichment.cancelled",
          entityId: completedChannelId,
          metadata: { previousStatus: "running", bulk: true },
        }),
      ],
    });
  });

  it("resolves filter-wide cancellation through the catalog query", async () => {
    listAllChannelIdsForCatalogFiltersMock.mockResolvedValue([queuedChannelId]);
    prismaMock.channelEnrichment.findMany.mockResolvedValue([
      { channelId: queuedChannelId, status: ChannelEnrichmentStatus.QUEUED },
    ]);
    prismaMock.channelEnrichment.updateManyAndReturn.mockResolvedValue([
      { channelId: queuedChannelId },
    ]);

    await cancelBulkChannelLlmEnrichment({
      actorUserId: requestedByUserId,
      scope: { type: "filtered", filters: { enrichmentStatus: ["running"] } },
    });

    expect(listAllChannelIdsForCatalogFiltersMock).toHaveBeenCalledWith({
      enrichmentStatus: ["running"],
    });
  });
});
