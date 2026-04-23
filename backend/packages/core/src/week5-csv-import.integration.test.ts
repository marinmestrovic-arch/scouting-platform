import { PrismaClient, Role } from "@prisma/client";
import { CSV_IMPORT_HEADER, CSV_IMPORT_LEGACY_V3_HEADER } from "@scouting-platform/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type ImportsModule = typeof import("./imports/index");
type ImportsQueueModule = typeof import("./imports/queue");

integration("week 5 csv import core integration", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    vi.resetModules();
    vi.doUnmock("./imports/queue");
    vi.doUnmock("@scouting-platform/integrations");

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        dropdown_values,
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
    vi.doUnmock("@scouting-platform/integrations");
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

  function makeLegacyCsv(rows: string[]): string {
    return [
      "youtubeChannelId,channelTitle,contactEmail,firstName,lastName,subscriberCount,viewCount,videoCount,notes,sourceLabel,influencerType,influencerVertical,countryRegion,language",
      ...rows,
    ].join("\n");
  }

  function creatorListRow(values: string[]): string {
    if (values.length === CSV_IMPORT_HEADER.length) {
      return values.join(",");
    }

    const valueByLegacyHeader = new Map<string, string>();
    CSV_IMPORT_LEGACY_V3_HEADER.forEach((header, index) => {
      valueByLegacyHeader.set(header, values[index] ?? "");
    });

    const row = CSV_IMPORT_HEADER.map((header) => valueByLegacyHeader.get(header) ?? "");

    while (row.length < CSV_IMPORT_HEADER.length) {
      row.push("");
    }

    return row
      .map((value) => {
        if (/[",\n\r]/.test(value)) {
          return `"${value.replace(/"/g, "\"\"")}"`;
        }

        return value;
      })
      .join(",");
  }

  function makeCreatorListCsv(rows: string[]): string {
    return [
      CSV_IMPORT_HEADER.join(","),
      ...rows,
    ].join("\n");
  }

  function makeDeprecatedYoutubeAverageHeader(): string {
    const header: string[] = [...CSV_IMPORT_HEADER];
    const insertIndex = header.indexOf("YouTube Video Median Views");

    if (insertIndex === -1) {
      throw new Error("YouTube Video Median Views header is missing");
    }

    header.splice(insertIndex, 0, "YouTube Average Views");
    return header.join(",");
  }

  async function seedSyncedDropdownValues(): Promise<void> {
    await prisma.dropdownValue.createMany({
      data: [
        { fieldKey: "INFLUENCER_TYPE", value: "Male" },
        { fieldKey: "INFLUENCER_VERTICAL", value: "Gaming" },
        { fieldKey: "COUNTRY_REGION", value: "Croatia" },
        { fieldKey: "LANGUAGE", value: "Croatian" },
        { fieldKey: "LANGUAGE", value: "German" },
      ],
    });
  }

  it("creates a queued batch, stores row-level validation errors, and exposes list/detail responses", async () => {
    const imports = await loadImports();
    const admin = await createUser("admin@example.com");
    await seedSyncedDropdownValues();

    const batch = await imports.createCsvImportBatch({
      requestedByUserId: admin.id,
      fileName: "contacts.csv",
      fileSize: 512,
      csvText: makeCreatorListCsv([
        creatorListRow([
          "Creator One",
          "",
          "",
          "https://www.youtube.com/channel/UC-CSV-1",
          "Spring Campaign",
          "Owner",
          "",
          "creator@example.com",
          "",
          "EUR",
          "Paid",
          "Influencer",
          "April",
          "2026",
          "Client A",
          "Creator One - Spring Campaign",
          "Creator One - Spring Campaign",
          "Sales Pipeline",
          "Scouted",
          "",
          "",
          "Male",
          "Gaming",
          "Croatia",
          "Croatian",
          "@creatorone",
          "https://www.youtube.com/@creatorone",
          "22,000",
          "11,000",
          "2.10%",
          "1,000",
        ]),
        creatorListRow([
          "Creator Two",
          "",
          "",
          "https://www.youtube.com/channel/UC-CSV-2",
          "Spring Campaign",
          "Owner",
          "",
          "not-an-email",
          "",
          "EUR",
          "Paid",
          "Influencer",
          "April",
          "2026",
          "Client A",
          "Creator Two - Spring Campaign",
          "Creator Two - Spring Campaign",
          "Sales Pipeline",
          "Scouted",
          "",
          "",
          "Male",
          "Gaming",
          "Croatia",
          "Croatian",
          "@creatortwo",
          "https://www.youtube.com/@creatortwo",
          "32000",
          "18000",
          "3.2",
          "2000",
        ]),
      ]),
    });

    expect(batch.status).toBe("queued");
    expect(batch.templateVersion).toBe("v3");
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
    expect(detail.rows[1]?.errorMessage).toContain("Email is invalid");

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
    await seedSyncedDropdownValues();

    const batch = await imports.createCsvImportBatch({
      requestedByUserId: admin.id,
      fileName: "invalid.csv",
      fileSize: 256,
      csvText: makeCreatorListCsv([
        creatorListRow([
          "",
          "",
          "",
          "https://www.youtube.com/channel/UC-CSV-1",
          "Spring Campaign",
          "Owner",
          "",
          "creator@example.com",
          "",
          "EUR",
          "Paid",
          "Influencer",
          "April",
          "2026",
          "Client A",
          "Deal One",
          "Deal One",
          "Sales Pipeline",
          "Scouted",
          "",
          "",
          "Male",
          "Gaming",
          "Croatia",
          "Croatian",
          "",
          "",
          "",
          "",
          "",
          "1000",
        ]),
        creatorListRow([
          "Creator Two",
          "",
          "",
          "",
          "Spring Campaign",
          "Owner",
          "",
          "creator-two@example.com",
          "",
          "EUR",
          "Paid",
          "Influencer",
          "April",
          "2026",
          "Client A",
          "Deal Two",
          "Deal Two",
          "Sales Pipeline",
          "Scouted",
          "",
          "",
          "Male",
          "Gaming",
          "Croatia",
          "Croatian",
          "",
          "",
          "",
          "",
          "",
          "2000",
        ]),
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
    await seedSyncedDropdownValues();

    const batch = await imports.createCsvImportBatch({
      requestedByUserId: admin.id,
      fileName: "dedupe.csv",
      fileSize: 1024,
      csvText: makeLegacyCsv([
        "UC-CSV-1,Creator One,FIRST@example.com,,,100,1000,10,first row,ops,Male,Gaming,Croatia,Croatian",
        "UC-CSV-1,Creator One,first@example.com,,,,2000,,duplicate email,ops,,,,",
        "UC-CSV-1,Creator One,second@example.com,,,,,11,second email,ops,,,,German",
      ]),
    });
    expect(batch.templateVersion).toBe("v2");

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
    expect(channels[0]?.influencerType).toBe("Male");
    expect(channels[0]?.influencerVertical).toBe("Gaming");
    expect(channels[0]?.countryRegion).toBe("Croatia");
    expect(channels[0]?.contentLanguage).toBe("German");

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

  it("resolves existing channels when stored handle omits @ but csv uses @handle youtube urls", async () => {
    const imports = await loadImports();
    const admin = await createUser("admin@example.com");
    await seedSyncedDropdownValues();

    const existingChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-FRANK-SLOTTA",
        title: "Frank Slotta",
        handle: "frankslotta",
        youtubeUrl: "https://www.youtube.com/channel/UC-FRANK-SLOTTA",
      },
      select: {
        id: true,
      },
    });

    const batch = await imports.createCsvImportBatch({
      requestedByUserId: admin.id,
      fileName: "handle-resolution.csv",
      fileSize: 512,
      csvText: makeCreatorListCsv([
        creatorListRow([
          "Frank Slotta",
          "",
          "",
          "https://www.youtube.com/@FrankSlotta",
          "",
          "",
          "",
          "daantje@amillionfaces.nl",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "Frank",
          "Slotta",
          "Male",
          "Gaming",
          "Croatia",
          "Croatian",
          "@FrankSlotta",
          "https://www.youtube.com/@FrankSlotta",
          "149,937",
          "16,913",
          "2.25%",
          "434,000",
        ]),
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
    expect(updatedBatch.importedRowCount).toBe(1);
    expect(updatedBatch.failedRowCount).toBe(0);

    const rows = await prisma.csvImportRow.findMany({
      where: {
        batchId: batch.id,
      },
      select: {
        status: true,
        channelId: true,
        errorMessage: true,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("IMPORTED");
    expect(rows[0]?.channelId).toBe(existingChannel.id);
    expect(rows[0]?.errorMessage).toBeNull();

    const channelCount = await prisma.channel.count();
    expect(channelCount).toBe(1);
  });

  it("resolves youtube channel id from @handle urls and creates channel when no existing match exists", async () => {
    vi.resetModules();
    vi.doUnmock("./imports/queue");
    vi.doMock("@scouting-platform/integrations", async () => {
      const actual = await vi.importActual<typeof import("@scouting-platform/integrations")>(
        "@scouting-platform/integrations",
      );

      return {
        ...actual,
        resolveYoutubeChannelForEnrichment: vi.fn(async () => ({
          channelId: "UCoVGcDm7a76Lvf26AB-olOA",
          canonicalUrl: "https://www.youtube.com/channel/UCoVGcDm7a76Lvf26AB-olOA",
        })),
      };
    });

    const imports = await loadImports();
    const admin = await createUser("admin@example.com");
    await seedSyncedDropdownValues();

    const batch = await imports.createCsvImportBatch({
      requestedByUserId: admin.id,
      fileName: "url-resolution.csv",
      fileSize: 512,
      csvText: makeCreatorListCsv([
        creatorListRow([
          "Frank Slotta",
          "",
          "",
          "https://www.youtube.com/@FrankSlotta",
          "",
          "",
          "",
          "daantje@amillionfaces.nl",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "Frank",
          "Slotta",
          "Male",
          "Gaming",
          "Croatia",
          "Croatian",
          "@FrankSlotta",
          "https://www.youtube.com/@FrankSlotta",
          "149,937",
          "16,913",
          "2.25%",
          "434,000",
        ]),
      ]),
    });

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'imports.csv.process'
    `);

    await imports.executeCsvImportBatch({
      importBatchId: batch.id,
      requestedByUserId: admin.id,
    });

    const createdChannel = await prisma.channel.findUniqueOrThrow({
      where: {
        youtubeChannelId: "UCoVGcDm7a76Lvf26AB-olOA",
      },
      select: {
        title: true,
        handle: true,
        youtubeUrl: true,
      },
    });
    expect(createdChannel.title).toBe("Frank Slotta");
    expect(createdChannel.handle).toBe("@frankslotta");
    expect(createdChannel.youtubeUrl).toBe("https://www.youtube.com/@FrankSlotta");

    const row = await prisma.csvImportRow.findFirstOrThrow({
      where: {
        batchId: batch.id,
      },
      select: {
        status: true,
        errorMessage: true,
      },
    });
    expect(row.status).toBe("IMPORTED");
    expect(row.errorMessage).toBeNull();
  });

  it("persists lastError and a failed audit when enqueueing the batch fails", async () => {
    const admin = await createUser("admin@example.com");
    await seedSyncedDropdownValues();

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
      csvText: makeLegacyCsv([
        "UC-CSV-9,Creator Nine,creator-nine@example.com,,,100,1000,10,,ops,Male,Gaming,Croatia,Croatian",
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

  it("fails with a clear configuration error when HubSpot-synced dropdown values are missing", async () => {
    const imports = await loadImports();
    const admin = await createUser("admin@example.com");

    await expect(
      imports.createCsvImportBatch({
        requestedByUserId: admin.id,
        fileName: "missing-dropdowns.csv",
        fileSize: 256,
        csvText: makeCreatorListCsv([
          creatorListRow([
            "Creator One",
            "",
            "",
            "https://www.youtube.com/channel/UC-CSV-1",
            "Spring Campaign",
            "Owner",
            "",
            "creator@example.com",
            "",
            "EUR",
            "Paid",
            "Influencer",
            "April",
            "2026",
            "Client A",
            "Deal One",
            "Deal One",
            "Sales Pipeline",
            "Scouted",
            "",
            "",
            "Male",
            "Gaming",
            "Croatia",
            "Croatian",
            "@creatorone",
            "https://www.youtube.com/@creatorone",
            "22000",
            "11000",
            "2.1",
            "1000",
          ]),
        ]),
      }),
    ).rejects.toMatchObject({
      message: "HubSpot dropdown values are not configured. Sync dropdown values from HubSpot before importing CSV.",
    });
  });

  it("fails rows that use values outside the saved HubSpot dropdown options", async () => {
    const imports = await loadImports();
    const admin = await createUser("admin@example.com");
    await seedSyncedDropdownValues();

    const batch = await imports.createCsvImportBatch({
      requestedByUserId: admin.id,
      fileName: "invalid-dropdowns.csv",
      fileSize: 256,
      csvText: makeCreatorListCsv([
        creatorListRow([
          "Creator One",
          "",
          "",
          "https://www.youtube.com/channel/UC-CSV-1",
          "Spring Campaign",
          "Owner",
          "",
          "creator@example.com",
          "",
          "EUR",
          "Paid",
          "Influencer",
          "April",
          "2026",
          "Client A",
          "Deal One",
          "Deal One",
          "Sales Pipeline",
          "Scouted",
          "",
          "",
          "Unknown",
          "Gaming",
          "Croatia",
          "Croatian",
          "@creatorone",
          "https://www.youtube.com/@creatorone",
          "22000",
          "11000",
          "2.1",
          "1000",
        ]),
      ]),
    });

    expect(batch.status).toBe("completed");
    expect(batch.failedRowCount).toBe(1);

    const detail = await imports.getCsvImportBatchById({
      importBatchId: batch.id,
      page: 1,
      pageSize: 100,
    });

    expect(detail.rows[0]?.errorMessage).toContain(
      "Influencer Type must use a saved HubSpot dropdown value",
    );
  });

  it("rejects csv headers containing the deprecated youtube average views column", async () => {
    const imports = await loadImports();
    const admin = await createUser("admin@example.com");
    const deprecatedRow = Array.from({ length: CSV_IMPORT_HEADER.length + 1 }, (_, index) =>
      index === 0 ? "Creator One" : "",
    ).join(",");

    await expect(
      imports.createCsvImportBatch({
        requestedByUserId: admin.id,
        fileName: "legacy-youtube-average.csv",
        fileSize: 256,
        csvText: [
          makeDeprecatedYoutubeAverageHeader(),
          deprecatedRow,
        ].join("\n"),
      }),
    ).rejects.toMatchObject({
      message: "YouTube Average Views is no longer supported. Use YouTube Video Median Views.",
    });
  });
});
