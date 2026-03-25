import { PrismaClient, Role } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type ImportsModule = typeof import("./imports/index");
type ImportsQueueModule = typeof import("./imports/queue");

integration("week 5 csv import core integration", () => {
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
    vi.doUnmock("./imports/queue");

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
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
      DELETE FROM pgboss.job WHERE name = 'imports.csv.process'
    `);

    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterEach(async () => {
    const queue = (await import("./imports/queue")) as ImportsQueueModule;
    await queue.stopCsvImportsQueue();
    vi.resetModules();
    vi.doUnmock("./imports/queue");
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterAll(async () => {
    const queue = (await import("./imports/queue")) as ImportsQueueModule;
    await queue.stopCsvImportsQueue();
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    await prisma.$disconnect();
  });

  async function loadImports(): Promise<ImportsModule> {
    return import("./imports/index");
  }

  async function createUser(email: string, role: Role = Role.ADMIN): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email,
        name: role === Role.ADMIN ? "Admin" : "User",
        role,
        passwordHash: "hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  function makeCsv(rows: string[]): string {
    return [
      "youtubeChannelId,channelTitle,contactEmail,firstName,lastName,subscriberCount,viewCount,videoCount,notes,sourceLabel",
      ...rows,
    ].join("\n");
  }

  it("creates a queued batch, stores row-level validation errors, and exposes list/detail responses", async () => {
    const imports = await loadImports();
    const admin = await createUser("admin@example.com");

    const batch = await imports.createCsvImportBatch({
      requestedByUserId: admin.id,
      fileName: "contacts.csv",
      fileSize: 512,
      csvText: makeCsv([
        "UC-CSV-1,Creator One,creator@example.com,Creator,One,1000,20000,50,Top creator,ops",
        "UC-CSV-2,Creator Two,not-an-email,Creator,Two,2000,30000,60,,ops",
      ]),
    });

    expect(batch.status).toBe("queued");
    expect(batch.totalRowCount).toBe(2);
    expect(batch.failedRowCount).toBe(1);

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'imports.csv.process'
    `;
    expect(jobs[0]?.count).toBe(1);

    const list = await imports.listCsvImportBatches();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(batch.id);

    const detail = await imports.getCsvImportBatchById({
      importBatchId: batch.id,
      page: 1,
      pageSize: 100,
    });
    expect(detail.rows).toHaveLength(2);
    expect(detail.rows[0]?.rowNumber).toBe(2);
    expect(detail.rows[0]?.status).toBe("pending");
    expect(detail.rows[1]?.rowNumber).toBe(3);
    expect(detail.rows[1]?.status).toBe("failed");
    expect(detail.rows[1]?.errorMessage).toContain("contactEmail is invalid");

    const requestedAudit = await prisma.auditEvent.findFirst({
      where: {
        action: "csv_import.requested",
        entityId: batch.id,
      },
    });
    expect(requestedAudit).not.toBeNull();
  });

  it("completes immediately and does not enqueue when all rows are invalid", async () => {
    const imports = await loadImports();
    const admin = await createUser("admin@example.com");

    const batch = await imports.createCsvImportBatch({
      requestedByUserId: admin.id,
      fileName: "invalid.csv",
      fileSize: 256,
      csvText: makeCsv([
        "UC-CSV-1,,creator@example.com,,,1000,20000,50,,ops",
        ",Creator Two,creator-two@example.com,,,2000,30000,60,,ops",
      ]),
    });

    expect(batch.status).toBe("completed");
    expect(batch.importedRowCount).toBe(0);
    expect(batch.failedRowCount).toBe(2);

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'imports.csv.process'
    `;
    expect(jobs[0]?.count).toBe(0);

    const completedAudit = await prisma.auditEvent.findFirst({
      where: {
        action: "csv_import.completed",
        entityId: batch.id,
      },
    });
    expect(completedAudit).not.toBeNull();
  });

  it("imports pending rows, dedupes contacts, preserves existing metric values on blank cells, and is retry-safe", async () => {
    const imports = await loadImports();
    const admin = await createUser("admin@example.com");

    const batch = await imports.createCsvImportBatch({
      requestedByUserId: admin.id,
      fileName: "dedupe.csv",
      fileSize: 1024,
      csvText: makeCsv([
        "UC-CSV-1,Creator One,FIRST@example.com,Creator,One,100,1000,10,first row,ops",
        "UC-CSV-1,Creator One,first@example.com,,,,2000,,duplicate email,ops",
        "UC-CSV-1,Creator One,second@example.com,,,,,11,second email,ops",
      ]),
    });

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'imports.csv.process'
    `);

    await imports.executeCsvImportBatch({
      importBatchId: batch.id,
      requestedByUserId: admin.id,
    });

    const updatedBatch = await prisma.csvImportBatch.findUniqueOrThrow({
      where: {
        id: batch.id,
      },
    });
    expect(updatedBatch.status).toBe("COMPLETED");
    expect(updatedBatch.importedRowCount).toBe(3);
    expect(updatedBatch.failedRowCount).toBe(0);
    expect(updatedBatch.lastError).toBeNull();

    const channels = await prisma.channel.findMany();
    expect(channels).toHaveLength(1);

    const contacts = await prisma.channelContact.findMany({
      orderBy: {
        email: "asc",
      },
    });
    expect(contacts).toHaveLength(2);
    expect(contacts.map((contact) => contact.email)).toEqual([
      "first@example.com",
      "second@example.com",
    ]);

    const metric = await prisma.channelMetric.findUniqueOrThrow({
      where: {
        channelId: channels[0]!.id,
      },
    });
    expect(metric.subscriberCount).toBe(100n);
    expect(metric.viewCount).toBe(2000n);
    expect(metric.videoCount).toBe(11n);

    const rows = await prisma.csvImportRow.findMany({
      where: {
        batchId: batch.id,
      },
      orderBy: {
        rowNumber: "asc",
      },
    });
    expect(rows.every((row) => row.status === "IMPORTED")).toBe(true);
    expect(rows.every((row) => row.channelId === channels[0]!.id)).toBe(true);

    await imports.executeCsvImportBatch({
      importBatchId: batch.id,
      requestedByUserId: admin.id,
    });

    const retriedContacts = await prisma.channelContact.count();
    expect(retriedContacts).toBe(2);
  });

  it("persists lastError and a failed audit when enqueueing the batch fails", async () => {
    const admin = await createUser("admin@example.com");

    vi.resetModules();
    vi.doMock("./imports/queue", () => ({
      enqueueCsvImportJob: vi.fn(async () => {
        throw new Error("queue down");
      }),
      stopCsvImportsQueue: vi.fn(async () => undefined),
    }));

    const imports = await import("./imports/index");
    const batch = await imports.createCsvImportBatch({
      requestedByUserId: admin.id,
      fileName: "queue-failure.csv",
      fileSize: 512,
      csvText: makeCsv([
        "UC-CSV-9,Creator Nine,creator-nine@example.com,Creator,Nine,100,1000,10,,ops",
      ]),
    });

    expect(batch.status).toBe("failed");
    expect(batch.lastError).toBe("queue down");

    const failedAudit = await prisma.auditEvent.findFirst({
      where: {
        action: "csv_import.failed",
        entityId: batch.id,
      },
    });
    expect(failedAudit).not.toBeNull();

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'imports.csv.process'
    `;
    expect(jobs[0]?.count).toBe(0);
  });
});
