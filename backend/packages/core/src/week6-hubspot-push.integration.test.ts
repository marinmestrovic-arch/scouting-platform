import { HubspotPushBatchRowStatus, HubspotPushBatchStatus, PrismaClient, Role } from "@prisma/client";
import type {
  BatchUpsertHubspotContactsInput,
  HubspotBatchUpsertOutcome,
} from "@scouting-platform/integrations";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type HubspotModule = typeof import("./hubspot/index");
type HubspotQueueModule = typeof import("./hubspot/queue");

integration("week 6 hubspot push core integration", () => {
  let prisma: PrismaClient;
  let batchUpsertHubspotContactsMock: ReturnType<typeof vi.fn>;

  async function deliverBatchOutcomes(
    input: BatchUpsertHubspotContactsInput,
    outcomes: HubspotBatchUpsertOutcome[],
  ): Promise<{ outcomes: HubspotBatchUpsertOutcome[]; succeeded: number; failed: number }> {
    const succeeded = outcomes.filter((outcome) => outcome.success).length;
    const failed = outcomes.length - succeeded;

    await input.onChunkComplete?.({
      chunkIndex: 0,
      inputStartIndex: 0,
      inputEndIndexExclusive: input.records.length,
      outcomes,
      succeeded,
      failed,
    });

    return { outcomes, succeeded, failed };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    vi.doUnmock("./hubspot/queue");
    vi.resetModules();

    batchUpsertHubspotContactsMock = vi.fn(
      async (input: BatchUpsertHubspotContactsInput) =>
        deliverBatchOutcomes(
          input,
          input.records.map((record, inputIndex) => ({
            inputIndex,
            objectWriteTraceId: record.objectWriteTraceId ?? `trace-${inputIndex}`,
            success: true as const,
            id: `hubspot-contact-${inputIndex + 1}`,
            created: true,
            properties: {},
          })),
        ),
    );
    vi.doMock("@scouting-platform/integrations", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@scouting-platform/integrations")>()),
      batchUpsertHubspotContacts: batchUpsertHubspotContactsMock,
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

    batchUpsertHubspotContactsMock.mockImplementation(
      async (input: BatchUpsertHubspotContactsInput) =>
        deliverBatchOutcomes(
          input,
          input.records.map((record, inputIndex) =>
            record.id === "fail@example.com"
              ? {
                  inputIndex,
                  objectWriteTraceId: record.objectWriteTraceId ?? `trace-${inputIndex}`,
                  success: false as const,
                  category: "VALIDATION_ERROR",
                  code: "INVALID_EMAIL",
                  message: "HubSpot request failed",
                }
              : {
                  inputIndex,
                  objectWriteTraceId: record.objectWriteTraceId ?? `trace-${inputIndex}`,
                  success: true as const,
                  id: "hubspot-contact-1",
                  created: true,
                  properties: {},
                },
          ),
        ),
    );

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
    });
    const rowsByChannel = new Map(rows.map((row) => [row.channelId, row]));
    expect(rowsByChannel.get(successChannel.id)).toMatchObject({
      status: HubspotPushBatchRowStatus.PUSHED,
      hubspotObjectId: "hubspot-contact-1",
      errorMessage: null,
    });
    expect(rowsByChannel.get(missingEmailChannel.id)).toMatchObject({
      status: HubspotPushBatchRowStatus.FAILED,
      errorMessage: "Channel has no contact email",
    });
    expect(rowsByChannel.get(providerFailChannel.id)).toMatchObject({
      status: HubspotPushBatchRowStatus.FAILED,
      errorMessage: "HubSpot request failed",
    });
    expect(batchUpsertHubspotContactsMock).toHaveBeenCalledTimes(1);
    const request = batchUpsertHubspotContactsMock.mock.calls[0]?.[0] as
      | BatchUpsertHubspotContactsInput
      | undefined;
    expect(request).toEqual(expect.objectContaining({
      allowEmailIdentifierForFullUpsert: true,
      records: [
        expect.objectContaining({
          id: "success@example.com",
          idProperty: "email",
          properties: expect.objectContaining({
            contact_type: "Influencer",
            platforms: "YouTube",
            youtube_followers: "5000",
            influencer_size: "Micro (5K - 20K)",
            influencer_vertical: "Lifestyle",
          }),
        }),
        expect.objectContaining({
          id: "fail@example.com",
          idProperty: "email",
        }),
      ],
    }));
    expect(request?.records[0]?.properties).not.toHaveProperty("creator_title");

    const completedAudit = await prisma.auditEvent.findFirst({
      where: {
        entityType: "hubspot_push_batch",
        entityId: batch.id,
        action: "hubspot_push.completed",
      },
    });
    expect(completedAudit).not.toBeNull();
  });

  it("omits unknown optional creator values instead of clearing existing HubSpot fields", async () => {
    const hubspotModule = await loadHubspot();
    const manager = await createUser("unknown-values@example.com");
    const channel = await createChannel({
      youtubeChannelId: "UC-HUB-UNKNOWN-VALUES",
      title: "Unknown Values",
      requestedByUserId: manager.id,
      contactEmails: ["unknown-values@example.com"],
    });
    await prisma.channelMetric.update({
      where: { channelId: channel.id },
      data: {
        subscriberCount: null,
        viewCount: null,
        videoCount: null,
        youtubeFollowers: null,
        youtubeEngagementRate: null,
      },
    });
    await prisma.channelEnrichment.update({
      where: { channelId: channel.id },
      data: { topics: [] },
    });

    const batch = await hubspotModule.createHubspotPushBatch({
      requestedByUserId: manager.id,
      channelIds: [channel.id],
    });
    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'hubspot.push.batch'
    `);

    await hubspotModule.executeHubspotPushBatch({
      pushBatchId: batch.id,
      requestedByUserId: manager.id,
    });

    const request = batchUpsertHubspotContactsMock.mock.calls[0]?.[0] as
      | BatchUpsertHubspotContactsInput
      | undefined;
    const properties = request?.records[0]?.properties;
    expect(properties).toEqual(expect.objectContaining({
      email: "unknown-values@example.com",
      contact_type: "Influencer",
      platforms: "YouTube",
    }));
    expect(properties).not.toHaveProperty("youtube_handle");
    expect(properties).not.toHaveProperty("youtube_followers");
    expect(properties).not.toHaveProperty("youtube_video_average_views");
    expect(properties).not.toHaveProperty("youtube_engagement_rate");
    expect(properties).not.toHaveProperty("language");
    expect(properties).not.toHaveProperty("influencer_size");
    expect(properties).not.toHaveProperty("influencer_vertical");
  });

  it("reclaims only stale RUNNING legacy pushes", async () => {
    const hubspotModule = await loadHubspot();
    const manager = await createUser("legacy-reclaim@example.com");
    const channel = await createChannel({
      youtubeChannelId: "UC-HUB-LEGACY-RECLAIM",
      title: "Legacy Reclaim",
      requestedByUserId: manager.id,
      contactEmails: ["legacy-reclaim@example.com"],
    });
    const batch = await hubspotModule.createHubspotPushBatch({
      requestedByUserId: manager.id,
      channelIds: [channel.id],
    });
    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'hubspot.push.batch'
    `);
    await prisma.hubspotPushBatch.update({
      where: { id: batch.id },
      data: {
        status: HubspotPushBatchStatus.RUNNING,
        startedAt: new Date(Date.now() - 30 * 60 * 1_000),
        updatedAt: new Date(),
      },
    });

    const active = await hubspotModule.executeHubspotPushBatch({
      pushBatchId: batch.id,
      requestedByUserId: manager.id,
    });
    expect(active.status).toBe("running");
    expect(batchUpsertHubspotContactsMock).not.toHaveBeenCalled();

    await prisma.hubspotPushBatch.update({
      where: { id: batch.id },
      data: { updatedAt: new Date(Date.now() - 16 * 60 * 1_000) },
    });
    const reclaimed = await hubspotModule.executeHubspotPushBatch({
      pushBatchId: batch.id,
      requestedByUserId: manager.id,
    });

    expect(reclaimed.status).toBe("completed");
    expect(reclaimed.pushedRowCount).toBe(1);
    expect(batchUpsertHubspotContactsMock).toHaveBeenCalledTimes(1);
  });

  it("durably fails and audits legacy push creation when enqueueing fails", async () => {
    vi.doMock("./hubspot/queue", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./hubspot/queue")>()),
      enqueueHubspotPushJob: vi.fn().mockRejectedValue(new Error("legacy queue offline")),
    }));
    const hubspotModule = await loadHubspot();
    const manager = await createUser("legacy-enqueue-failure@example.com");
    const channel = await createChannel({
      youtubeChannelId: "UC-HUB-LEGACY-ENQUEUE",
      title: "Legacy Enqueue Failure",
      requestedByUserId: manager.id,
      contactEmails: ["legacy-enqueue-failure@example.com"],
    });

    await expect(
      hubspotModule.createHubspotPushBatch({
        requestedByUserId: manager.id,
        channelIds: [channel.id],
      }),
    ).rejects.toThrow("legacy queue offline");

    const failed = await prisma.hubspotPushBatch.findFirstOrThrow({
      where: { requestedByUserId: manager.id },
    });
    expect(failed.status).toBe(HubspotPushBatchStatus.FAILED);
    expect(failed.completedAt).not.toBeNull();
    expect(failed.lastError).toContain(
      "HubSpot push queue unavailable: legacy queue offline",
    );
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityId: failed.id,
        action: "hubspot_push.enqueue_failed",
      },
    });
    expect(audit.actorUserId).toBe(manager.id);
  });

  it("checkpoints successful rows and retries only unresolved rows after a provider crash", async () => {
    const hubspotModule = await loadHubspot();
    const manager = await createUser("manager@example.com");
    const firstChannel = await createChannel({
      youtubeChannelId: "UC-HUB-CHECKPOINT-1",
      title: "Hub Checkpoint One",
      requestedByUserId: manager.id,
      contactEmails: ["checkpoint-one@example.com"],
    });
    const secondChannel = await createChannel({
      youtubeChannelId: "UC-HUB-CHECKPOINT-2",
      title: "Hub Checkpoint Two",
      requestedByUserId: manager.id,
      contactEmails: ["checkpoint-two@example.com"],
    });

    batchUpsertHubspotContactsMock.mockImplementationOnce(
      async (input: BatchUpsertHubspotContactsInput) => {
        const firstRecord = input.records[0];
        if (!firstRecord) {
          throw new Error("Expected a first HubSpot record");
        }

        const outcome: HubspotBatchUpsertOutcome = {
          inputIndex: 0,
          objectWriteTraceId: firstRecord.objectWriteTraceId ?? "missing-trace",
          success: true,
          id: "hubspot-contact-checkpoint-1",
          created: true,
          properties: {},
        };
        await input.onChunkComplete?.({
          chunkIndex: 0,
          inputStartIndex: 0,
          inputEndIndexExclusive: 1,
          outcomes: [outcome],
          succeeded: 1,
          failed: 0,
        });

        throw new Error("Unexpected HubSpot outage");
      },
    );

    const batch = await hubspotModule.createHubspotPushBatch({
      requestedByUserId: manager.id,
      channelIds: [firstChannel.id, secondChannel.id],
    });

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'hubspot.push.batch'
    `);

    await expect(
      hubspotModule.executeHubspotPushBatch({
        pushBatchId: batch.id,
        requestedByUserId: manager.id,
      }),
    ).rejects.toThrow("Unexpected HubSpot outage");

    const failedBatch = await prisma.hubspotPushBatch.findUniqueOrThrow({
      where: { id: batch.id },
    });
    expect(failedBatch.status).toBe(HubspotPushBatchStatus.FAILED);
    expect(failedBatch.pushedRowCount).toBe(1);
    expect(failedBatch.failedRowCount).toBe(0);
    expect(failedBatch.lastError).toBe("Unexpected HubSpot outage");

    const checkpointedRows = await prisma.hubspotPushBatchRow.findMany({
      where: { batchId: batch.id },
    });
    const checkpointedByChannel = new Map(
      checkpointedRows.map((row) => [row.channelId, row]),
    );
    expect(checkpointedByChannel.get(firstChannel.id)).toMatchObject({
      status: HubspotPushBatchRowStatus.PUSHED,
      hubspotObjectId: "hubspot-contact-checkpoint-1",
    });
    expect(checkpointedByChannel.get(secondChannel.id)).toMatchObject({
      status: HubspotPushBatchRowStatus.PENDING,
      hubspotObjectId: null,
    });

    const failedAudit = await prisma.auditEvent.findFirst({
      where: {
        entityType: "hubspot_push_batch",
        entityId: batch.id,
        action: "hubspot_push.failed",
      },
    });
    expect(failedAudit).not.toBeNull();

    batchUpsertHubspotContactsMock.mockImplementationOnce(
      async (input: BatchUpsertHubspotContactsInput) =>
        deliverBatchOutcomes(
          input,
          input.records.map((record, inputIndex) => ({
            inputIndex,
            objectWriteTraceId: record.objectWriteTraceId ?? `trace-${inputIndex}`,
            success: true as const,
            id: "hubspot-contact-checkpoint-2",
            created: true,
            properties: {},
          })),
        ),
    );

    const retried = await hubspotModule.executeHubspotPushBatch({
      pushBatchId: batch.id,
      requestedByUserId: manager.id,
    });

    expect(retried.status).toBe("completed");
    expect(retried.pushedRowCount).toBe(2);
    expect(retried.failedRowCount).toBe(0);
    const retryRequest = batchUpsertHubspotContactsMock.mock.calls[1]?.[0] as
      | BatchUpsertHubspotContactsInput
      | undefined;
    expect(retryRequest?.records).toHaveLength(1);
    expect(retryRequest?.records[0]?.id).toBe("checkpoint-two@example.com");

    const completedRows = await prisma.hubspotPushBatchRow.findMany({
      where: { batchId: batch.id },
    });
    const completedByChannel = new Map(completedRows.map((row) => [row.channelId, row]));
    expect(completedByChannel.get(firstChannel.id)?.hubspotObjectId)
      .toBe("hubspot-contact-checkpoint-1");
    expect(completedByChannel.get(secondChannel.id)?.hubspotObjectId)
      .toBe("hubspot-contact-checkpoint-2");
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
    expect(batchUpsertHubspotContactsMock).not.toHaveBeenCalled();
    expect(rowResetSpy).not.toHaveBeenCalled();

    claimSpy.mockRestore();
    rowResetSpy.mockRestore();
  });
});
