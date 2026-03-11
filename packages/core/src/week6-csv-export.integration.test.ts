import {
  AdvancedReportRequestStatus,
  ChannelEnrichmentStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type ExportsModule = typeof import("./exports/index");
type ExportsQueueModule = typeof import("./exports/queue");

integration("week 6 csv export core integration", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    vi.resetModules();
    vi.doUnmock("./exports/queue");

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
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
      DELETE FROM pgboss.job WHERE name = 'exports.csv.generate'
    `);

    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterEach(async () => {
    const queue = (await import("./exports/queue")) as ExportsQueueModule;
    await queue.stopCsvExportsQueue();
    vi.resetModules();
    vi.doUnmock("./exports/queue");
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterAll(async () => {
    const queue = (await import("./exports/queue")) as ExportsQueueModule;
    await queue.stopCsvExportsQueue();
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    await prisma.$disconnect();
  });

  async function loadExports(): Promise<ExportsModule> {
    return import("./exports/index");
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
    subscriberCount?: bigint;
    viewCount?: bigint;
    videoCount?: bigint;
    enrichment?: {
      status: ChannelEnrichmentStatus;
      summary?: string;
      topics?: string[];
      brandFitNotes?: string;
      completedAt?: Date | null;
    };
    advancedReport?: {
      status: AdvancedReportRequestStatus;
      completedAt?: Date | null;
    };
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

    if (
      input.subscriberCount !== undefined ||
      input.viewCount !== undefined ||
      input.videoCount !== undefined
    ) {
      await prisma.channelMetric.create({
        data: {
          channelId: channel.id,
          ...(input.subscriberCount !== undefined ? { subscriberCount: input.subscriberCount } : {}),
          ...(input.viewCount !== undefined ? { viewCount: input.viewCount } : {}),
          ...(input.videoCount !== undefined ? { videoCount: input.videoCount } : {}),
        },
      });
    }

    if (input.enrichment) {
      const enrichmentData = {
        channelId: channel.id,
        status: input.enrichment.status,
        requestedByUserId: input.requestedByUserId,
        requestedAt: new Date(),
        completedAt: input.enrichment.completedAt ?? null,
        summary: input.enrichment.summary ?? null,
        brandFitNotes: input.enrichment.brandFitNotes ?? null,
        ...(input.enrichment.topics ? { topics: input.enrichment.topics } : {}),
      };

      await prisma.channelEnrichment.create({
        data: enrichmentData,
      });
    }

    if (input.advancedReport) {
      await prisma.advancedReportRequest.create({
        data: {
          channelId: channel.id,
          requestedByUserId: input.requestedByUserId,
          status: input.advancedReport.status,
          completedAt: input.advancedReport.completedAt ?? null,
        },
      });
    }

    return channel;
  }

  it("creates a selected export batch, dedupes channel ids, and restricts owner access", async () => {
    const exportsModule = await loadExports();
    const manager = await createUser("manager@example.com");
    const otherManager = await createUser("other-manager@example.com");
    const channelA = await createChannel({
      youtubeChannelId: "UC-EXPORT-1",
      title: "Export One",
      requestedByUserId: manager.id,
    });
    const channelB = await createChannel({
      youtubeChannelId: "UC-EXPORT-2",
      title: "Export Two",
      requestedByUserId: manager.id,
    });

    const batch = await exportsModule.createCsvExportBatch({
      requestedByUserId: manager.id,
      scope: {
        type: "selected",
        channelIds: [channelA.id, channelA.id, channelB.id],
      },
    });

    expect(batch.status).toBe("queued");
    expect(batch.scopeType).toBe("selected");

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'exports.csv.generate'
    `;
    expect(jobs[0]?.count).toBe(1);

    const detail = await exportsModule.getCsvExportBatchById({
      exportBatchId: batch.id,
      requestedByUserId: manager.id,
    });
    expect(detail.scope).toEqual({
      type: "selected",
      channelIds: [channelA.id, channelB.id],
    });

    const list = await exportsModule.listCsvExportBatches({
      requestedByUserId: manager.id,
    });
    expect(list).toHaveLength(1);

    await expect(
      exportsModule.getCsvExportBatchById({
        exportBatchId: batch.id,
        requestedByUserId: otherManager.id,
      }),
    ).rejects.toMatchObject({
      code: "CSV_EXPORT_BATCH_NOT_FOUND",
      status: 404,
    });
  });

  it("executes a selected export batch, stores the CSV, and audits downloads", async () => {
    const exportsModule = await loadExports();
    const manager = await createUser("manager@example.com");
    const channel = await createChannel({
      youtubeChannelId: "UC-EXPORT-RUN",
      title: "Export Ready",
      contactEmails: ["creator@example.com", "sales@example.com"],
      subscriberCount: 1500n,
      viewCount: 75000n,
      videoCount: 42n,
      enrichment: {
        status: ChannelEnrichmentStatus.COMPLETED,
        summary: "Space creator",
        topics: ["space", "rockets"],
        brandFitNotes: "Strong fit for launch brands",
        completedAt: new Date(),
      },
      advancedReport: {
        status: AdvancedReportRequestStatus.COMPLETED,
        completedAt: new Date(),
      },
      requestedByUserId: manager.id,
    });

    const batch = await exportsModule.createCsvExportBatch({
      requestedByUserId: manager.id,
      scope: {
        type: "selected",
        channelIds: [channel.id],
      },
    });

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'exports.csv.generate'
    `);

    await expect(
      exportsModule.downloadCsvExportBatch({
        exportBatchId: batch.id,
        requestedByUserId: manager.id,
      }),
    ).rejects.toMatchObject({
      code: "CSV_EXPORT_BATCH_NOT_READY",
      status: 409,
    });

    await exportsModule.executeCsvExportBatch({
      exportBatchId: batch.id,
      requestedByUserId: manager.id,
    });

    const detail = await exportsModule.getCsvExportBatchById({
      exportBatchId: batch.id,
      requestedByUserId: manager.id,
    });
    expect(detail.status).toBe("completed");
    expect(detail.rowCount).toBe(1);

    const download = await exportsModule.downloadCsvExportBatch({
      exportBatchId: batch.id,
      requestedByUserId: manager.id,
    });
    expect(download.fileName).toMatch(/\.csv$/);
    expect(download.csvContent).toContain("channelId,youtubeChannelId,youtubeChannelUrl");
    expect(download.csvContent).toContain(channel.id);
    expect(download.csvContent).toContain("creator@example.com;sales@example.com");
    expect(download.csvContent).toContain("space;rockets");

    const completedAudit = await prisma.auditEvent.findFirst({
      where: {
        action: "csv_export.completed",
        entityId: batch.id,
      },
    });
    expect(completedAudit).not.toBeNull();

    const downloadedAudit = await prisma.auditEvent.findFirst({
      where: {
        action: "csv_export.downloaded",
        entityId: batch.id,
      },
    });
    expect(downloadedAudit).not.toBeNull();
  });

  it("supports filtered exports, including empty filters for the full catalog", async () => {
    const exportsModule = await loadExports();
    const manager = await createUser("manager@example.com");
    await createChannel({
      youtubeChannelId: "UC-FILTER-READY",
      title: "Gaming Ready",
      enrichment: {
        status: ChannelEnrichmentStatus.QUEUED,
      },
      requestedByUserId: manager.id,
    });
    await createChannel({
      youtubeChannelId: "UC-FILTER-MISS",
      title: "Cooking Miss",
      requestedByUserId: manager.id,
    });

    const filteredBatch = await exportsModule.createCsvExportBatch({
      requestedByUserId: manager.id,
      scope: {
        type: "filtered",
        filters: {
          query: "gaming",
          enrichmentStatus: ["queued"],
        },
      },
    });

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'exports.csv.generate'
    `);

    await exportsModule.executeCsvExportBatch({
      exportBatchId: filteredBatch.id,
      requestedByUserId: manager.id,
    });

    const filteredDetail = await exportsModule.getCsvExportBatchById({
      exportBatchId: filteredBatch.id,
      requestedByUserId: manager.id,
    });
    expect(filteredDetail.status).toBe("completed");
    expect(filteredDetail.rowCount).toBe(1);

    const fullCatalogBatch = await exportsModule.createCsvExportBatch({
      requestedByUserId: manager.id,
      scope: {
        type: "filtered",
        filters: {},
      },
    });

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'exports.csv.generate'
    `);

    await exportsModule.executeCsvExportBatch({
      exportBatchId: fullCatalogBatch.id,
      requestedByUserId: manager.id,
    });

    const fullCatalogDetail = await exportsModule.getCsvExportBatchById({
      exportBatchId: fullCatalogBatch.id,
      requestedByUserId: manager.id,
    });
    expect(fullCatalogDetail.rowCount).toBe(2);
  });

  it("persists lastError and a failed audit when queue enqueueing fails", async () => {
    const manager = await createUser("manager@example.com");
    const channel = await createChannel({
      youtubeChannelId: "UC-QUEUE-FAIL",
      title: "Queue Fail",
      requestedByUserId: manager.id,
    });

    vi.resetModules();
    vi.doMock("./exports/queue", () => ({
      enqueueCsvExportJob: vi.fn(async () => {
        throw new Error("queue down");
      }),
      stopCsvExportsQueue: vi.fn(async () => undefined),
    }));

    const exportsModule = await import("./exports/index");
    const batch = await exportsModule.createCsvExportBatch({
      requestedByUserId: manager.id,
      scope: {
        type: "selected",
        channelIds: [channel.id],
      },
    });

    expect(batch.status).toBe("failed");
    expect(batch.lastError).toBe("queue down");

    const failedAudit = await prisma.auditEvent.findFirst({
      where: {
        action: "csv_export.failed",
        entityId: batch.id,
      },
    });
    expect(failedAudit).not.toBeNull();

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'exports.csv.generate'
    `;
    expect(jobs[0]?.count).toBe(0);
  });
});
