import { ChannelEnrichmentStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
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
      createMany: vi.fn(),
      findUnique: vi.fn(),
    },
    auditEvent: {
      createMany: vi.fn(),
    },
  };

  return {
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
  enqueueJob: enqueueJobMock,
}));

import { requestBulkChannelLlmEnrichment } from "./enrichment";

const requestedByUserId = "11111111-1111-4111-8111-111111111111";
const missingChannelId = "22222222-2222-4222-8222-222222222222";
const failedChannelId = "33333333-3333-4333-8333-333333333333";
const queuedChannelId = "44444444-4444-4444-8444-444444444444";
const completedChannelId = "55555555-5555-4555-8555-555555555555";

describe("bulk channel LLM enrichment requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.userProviderCredential.findUnique.mockResolvedValue({ id: "credential-id" });
    prismaMock.channelEnrichment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelEnrichment.createMany.mockResolvedValue({ count: 1 });
    prismaMock.auditEvent.createMany.mockResolvedValue({ count: 2 });
    enqueueJobMock.mockResolvedValue(undefined);
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
    expect(enqueueJobMock).toHaveBeenCalledTimes(2);
    expect(enqueueJobMock).toHaveBeenCalledWith("channels.enrich.llm", {
      channelId: missingChannelId,
      requestedByUserId,
    });
    expect(enqueueJobMock).toHaveBeenCalledWith("channels.enrich.llm", {
      channelId: failedChannelId,
      requestedByUserId,
    });
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
  });
});
