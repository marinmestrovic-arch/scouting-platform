import { HubspotPushBatchRowStatus, HubspotPushBatchStatus, PrismaClient, Role } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type HubspotModule = typeof import("./hubspot/index");
type HubspotQueueModule = typeof import("./hubspot/queue");

integration("week 6 hubspot push core integration", () => {
  let prisma: PrismaClient;
  let upsertHubspotContactMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    vi.resetModules();

    upsertHubspotContactMock = vi.fn();
    vi.doMock("@scouting-platform/integrations", () => ({
      upsertHubspotContact: upsertHubspotContactMock,
    }));

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        hubspot_push_batch_rows,
        hubspot_push_batches,
        csv_export_batches,
        csv_import_rows,
        channel_metrics,
        channel_contacts,
        csv_import_batches,
        advanced_report_requests,
        channel_provider_payloads,
        channel_insights,
        channel_enrichments,
        channel_youtube_contexts,
        channel_manual_overrides,
        saved_segments,
        run_results,
        run_requests,
        audit_events,
        user_provider_credentials,
        sessions,
        accounts,
        verification_tokens,
        channels,
        users
      RESTART IDENTITY CASCADE
    `);

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'hubspot.push.batch'
    `);

    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterEach(async () => {
    const queue = (await import("./hubspot/queue")) as HubspotQueueModule;
    await queue.stopHubspotPushQueue();
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterAll(async () => {
    const queue = (await import("./hubspot/queue")) as HubspotQueueModule;
    await queue.stopHubspotPushQueue();
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    await prisma.$disconnect();
  });

  async function loadHubspot(): Promise<HubspotModule> {
    return import("./hubspot/index");
  }

  async function createUser(email: string, role: Role = Role.USER): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email,
        name: role === Role.ADMIN ? "Admin" : "Manager",
        role,
        passwordHash: "hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  async function createChannel(input: {
    youtubeChannelId: string;
    title: string;
    contactEmails?: string[];
    requestedByUserId: string;
  }): Promise<{ id: string }> {
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: input.youtubeChannelId,
        title: input.title,
      },
      select: {
        id: true,
      },
    });

    if (input.contactEmails?.length) {
      await prisma.channelContact.createMany({
        data: input.contactEmails.map((email) => ({
          channelId: channel.id,
          email,
        })),
      });
    }

    await prisma.channelMetric.create({
      data: {
        channelId: channel.id,
        subscriberCount: 5000n,
        viewCount: 85000n,
        videoCount: 90n,
      },
    });

    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: "COMPLETED",
        requestedByUserId: input.requestedByUserId,
        requestedAt: new Date(),
        completedAt: new Date(),
        summary: "Lifestyle creator",
        topics: ["lifestyle"],
        brandFitNotes: "Strong fit",
      },
    });

    return channel;
  }

  it("creates a batch, dedupes channel ids, and restricts owner access", async () => {
    const hubspotModule = await loadHubspot();
    const manager = await createUser("manager@example.com");
    const otherManager = await createUser("other@example.com");
    const channelA = await createChannel({
      youtubeChannelId: "UC-HUB-1",
      title: "Hub One",
      requestedByUserId: manager.id,
      contactEmails: ["one@example.com"],
    });
    const channelB = await createChannel({
      youtubeChannelId: "UC-HUB-2",
      title: "Hub Two",
      requestedByUserId: manager.id,
      contactEmails: ["two@example.com"],
    });

    const batch = await hubspotModule.createHubspotPushBatch({
      requestedByUserId: manager.id,
      channelIds: [channelA.id, channelA.id, channelB.id],
    });

    expect(batch.status).toBe("queued");
    expect(batch.totalRowCount).toBe(2);

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'hubspot.push.batch'
    `;
    expect(jobs[0]?.count).toBe(1);

    const detail = await hubspotModule.getHubspotPushBatchById({
      pushBatchId: batch.id,
      requestedByUserId: manager.id,
    });
    expect(detail.scope.channelIds).toEqual([channelA.id, channelB.id]);

    await expect(
      hubspotModule.getHubspotPushBatchById({
        pushBatchId: batch.id,
        requestedByUserId: otherManager.id,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_PUSH_BATCH_NOT_FOUND",
      status: 404,
    });
  });

  it("executes row pushes, persists mixed row results, and audits completion", async () => {
    const hubspotModule = await loadHubspot();
    const manager = await createUser("manager@example.com");
    const successChannel = await createChannel({
      youtubeChannelId: "UC-HUB-SUCCESS",
      title: "Hub Success",
      requestedByUserId: manager.id,
      contactEmails: ["success@example.com"],
    });
    const missingEmailChannel = await createChannel({
      youtubeChannelId: "UC-HUB-MISSING",
      title: "Hub Missing",
      requestedByUserId: manager.id,
    });
    const providerFailChannel = await createChannel({
      youtubeChannelId: "UC-HUB-FAIL",
      title: "Hub Fail",
      requestedByUserId: manager.id,
      contactEmails: ["fail@example.com"],
    });

    upsertHubspotContactMock.mockImplementation(async ({ email }: { email: string }) => {
      if (email === "fail@example.com") {
        throw new Error("HubSpot request failed");
      }

      return { id: "hubspot-contact-1" };
    });

    const batch = await hubspotModule.createHubspotPushBatch({
      requestedByUserId: manager.id,
      channelIds: [successChannel.id, missingEmailChannel.id, providerFailChannel.id],
    });

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'hubspot.push.batch'
    `);

    const detail = await hubspotModule.executeHubspotPushBatch({
      pushBatchId: batch.id,
      requestedByUserId: manager.id,
    });

    expect(detail.status).toBe("completed");
    expect(detail.pushedRowCount).toBe(1);
    expect(detail.failedRowCount).toBe(2);

    const rows = await prisma.hubspotPushBatchRow.findMany({
      where: {
        batchId: batch.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    expect(rows.map((row) => row.status)).toEqual([
      HubspotPushBatchRowStatus.PUSHED,
      HubspotPushBatchRowStatus.FAILED,
      HubspotPushBatchRowStatus.FAILED,
    ]);
    expect(rows[0]?.hubspotObjectId).toBe("hubspot-contact-1");
    expect(rows[1]?.errorMessage).toBe("Channel has no contact email");
    expect(rows[2]?.errorMessage).toBe("HubSpot request failed");

    const completedAudit = await prisma.auditEvent.findFirst({
      where: {
        entityType: "hubspot_push_batch",
        entityId: batch.id,
        action: "hubspot_push.completed",
      },
    });
    expect(completedAudit).not.toBeNull();
  });

  it("marks the batch failed when the integration crashes before rows finish", async () => {
    const hubspotModule = await loadHubspot();
    const manager = await createUser("manager@example.com");
    const channel = await createChannel({
      youtubeChannelId: "UC-HUB-CRASH",
      title: "Hub Crash",
      requestedByUserId: manager.id,
      contactEmails: ["crash@example.com"],
    });

    upsertHubspotContactMock.mockRejectedValueOnce(new Error("Unexpected HubSpot outage"));

    const batch = await hubspotModule.createHubspotPushBatch({
      requestedByUserId: manager.id,
      channelIds: [channel.id],
    });

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'hubspot.push.batch'
    `);

    const detail = await hubspotModule.executeHubspotPushBatch({
      pushBatchId: batch.id,
      requestedByUserId: manager.id,
    });

    expect(detail.status).toBe("completed");
    expect(detail.failedRowCount).toBe(1);

    await prisma.hubspotPushBatch.update({
      where: { id: batch.id },
      data: { status: HubspotPushBatchStatus.QUEUED },
    });

    await prisma.hubspotPushBatchRow.deleteMany({
      where: { batchId: batch.id },
    });

    await prisma.hubspotPushBatchRow.create({
      data: {
        batchId: batch.id,
        channelId: channel.id,
      },
    });

    const db = await import("@scouting-platform/db");
    const spy = vi
      .spyOn(db.prisma.channel, "findMany")
      .mockRejectedValueOnce(new Error("DB load failed"));

    await expect(
      hubspotModule.executeHubspotPushBatch({
        pushBatchId: batch.id,
        requestedByUserId: manager.id,
      }),
    ).rejects.toThrow("DB load failed");

    spy.mockRestore();

    const failedBatch = await prisma.hubspotPushBatch.findUniqueOrThrow({
      where: { id: batch.id },
    });
    expect(failedBatch.status).toBe(HubspotPushBatchStatus.FAILED);
    expect(failedBatch.lastError).toBe("DB load failed");

    const failedAudit = await prisma.auditEvent.findFirst({
      where: {
        entityType: "hubspot_push_batch",
        entityId: batch.id,
        action: "hubspot_push.failed",
      },
    });
    expect(failedAudit).not.toBeNull();
  });

  it("returns existing detail when another worker wins the running claim", async () => {
    const hubspotModule = await loadHubspot();
    const manager = await createUser("manager@example.com");
    const channel = await createChannel({
      youtubeChannelId: "UC-HUB-CLAIM",
      title: "Hub Claim",
      requestedByUserId: manager.id,
      contactEmails: ["claim@example.com"],
    });

    const batch = await hubspotModule.createHubspotPushBatch({
      requestedByUserId: manager.id,
      channelIds: [channel.id],
    });

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'hubspot.push.batch'
    `);

    const db = await import("@scouting-platform/db");
    const claimSpy = vi
      .spyOn(db.prisma.hubspotPushBatch, "updateMany")
      .mockResolvedValueOnce({ count: 0 });
    const rowResetSpy = vi.spyOn(db.prisma.hubspotPushBatchRow, "updateMany");

    const detail = await hubspotModule.executeHubspotPushBatch({
      pushBatchId: batch.id,
      requestedByUserId: manager.id,
    });

    expect(detail.status).toBe("queued");
    expect(upsertHubspotContactMock).not.toHaveBeenCalled();
    expect(rowResetSpy).not.toHaveBeenCalled();

    claimSpy.mockRestore();
    rowResetSpy.mockRestore();
  });
});
