import {
  AdvancedReportRequestStatus as PrismaAdvancedReportRequestStatus,
  CredentialProvider,
  CsvImportBatchStatus as PrismaCsvImportBatchStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { createPrismaClient } from "@scouting-platform/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type CoreModule = typeof import("./index");

integration("week 5 admin dashboard core integration", () => {
  let prisma: PrismaClient;
  let core: CoreModule | null = null;

  function getCore(): CoreModule {
    if (!core) {
      throw new Error("Expected core module to be loaded");
    }

    return core;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;

    prisma = createPrismaClient({ databaseUrl });

    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    vi.resetModules();

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

    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    core = await import("./index");
  });

  afterEach(async () => {
    core = null;
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterAll(async () => {
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    await prisma.$disconnect();
  });

  async function createUser(input: {
    email: string;
    role?: Role;
    isActive?: boolean;
    createdAt?: Date;
  }): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email: input.email,
        name: input.role === Role.ADMIN ? "Admin" : "Manager",
        role: input.role ?? Role.USER,
        passwordHash: "hash",
        isActive: input.isActive ?? true,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
      select: {
        id: true,
      },
    });
  }

  async function assignYoutubeKey(userId: string): Promise<void> {
    await prisma.userProviderCredential.create({
      data: {
        userId,
        provider: CredentialProvider.YOUTUBE_DATA_API,
        encryptedSecret: "encrypted-secret",
        encryptionIv: "iv",
        encryptionAuthTag: "tag",
      },
    });
  }

  async function createChannel(youtubeChannelId: string, title: string): Promise<{ id: string }> {
    return prisma.channel.create({
      data: {
        youtubeChannelId,
        title,
      },
      select: {
        id: true,
      },
    });
  }

  async function createImportBatch(input: {
    requestedByUserId: string;
    fileName: string;
    status: PrismaCsvImportBatchStatus;
    createdAt: Date;
    totalRowCount?: number;
    importedRowCount?: number;
    failedRowCount?: number;
    lastError?: string | null;
  }): Promise<{ id: string }> {
    return prisma.csvImportBatch.create({
      data: {
        requestedByUserId: input.requestedByUserId,
        fileName: input.fileName,
        templateVersion: "v1",
        status: input.status,
        totalRowCount: input.totalRowCount ?? 10,
        importedRowCount: input.importedRowCount ?? 0,
        failedRowCount: input.failedRowCount ?? 0,
        lastError: input.lastError ?? null,
        createdAt: input.createdAt,
      },
      select: {
        id: true,
      },
    });
  }

  it("aggregates approval, import, and missing-key summaries with preview ordering and limits", async () => {
    const admin = await createUser({
      email: "admin@example.com",
      role: Role.ADMIN,
      createdAt: new Date("2026-01-01T09:00:00.000Z"),
    });

    const missingManagers = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((index) =>
        createUser({
          email: `manager-${index}@example.com`,
          createdAt: new Date(`2026-01-0${index}T09:00:00.000Z`),
        }),
      ),
    );
    const keyedManager = await createUser({
      email: "keyed-manager@example.com",
      createdAt: new Date("2026-01-07T09:00:00.000Z"),
    });
    await createUser({
      email: "inactive-manager@example.com",
      isActive: false,
      createdAt: new Date("2026-01-08T09:00:00.000Z"),
    });

    await assignYoutubeKey(keyedManager.id);

    const pendingChannels = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((index) =>
        createChannel(`UC-DASH-PENDING-${index}`, `Pending Channel ${index}`),
      ),
    );
    const firstPendingChannel = pendingChannels[0];
    const firstMissingManager = missingManagers[0];

    if (!firstPendingChannel || !firstMissingManager) {
      throw new Error("Expected seeded dashboard records");
    }

    const approvedChannel = await createChannel("UC-DASH-APPROVED", "Approved Channel");
    const queuedChannel = await createChannel("UC-DASH-QUEUED", "Queued Channel");
    const runningChannel = await createChannel("UC-DASH-RUNNING", "Running Channel");
    const failedChannel = await createChannel("UC-DASH-FAILED", "Failed Channel");

    const priorCompleted = await prisma.advancedReportRequest.create({
      data: {
        channelId: firstPendingChannel.id,
        requestedByUserId: firstMissingManager.id,
        status: PrismaAdvancedReportRequestStatus.COMPLETED,
        completedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        createdAt: new Date("2026-02-01T08:00:00.000Z"),
      },
      select: {
        id: true,
      },
    });

    await Promise.all(
      pendingChannels.map((channel, index) =>
        prisma.advancedReportRequest.create({
          data: {
            channelId: channel.id,
            requestedByUserId: firstMissingManager.id,
            status: PrismaAdvancedReportRequestStatus.PENDING_APPROVAL,
            createdAt: new Date(`2026-02-0${index + 1}T09:00:00.000Z`),
          },
        }),
      ),
    );

    await prisma.advancedReportRequest.create({
      data: {
        channelId: approvedChannel.id,
        requestedByUserId: firstMissingManager.id,
        status: PrismaAdvancedReportRequestStatus.APPROVED,
        createdAt: new Date("2026-02-10T09:00:00.000Z"),
      },
    });
    await prisma.advancedReportRequest.create({
      data: {
        channelId: queuedChannel.id,
        requestedByUserId: firstMissingManager.id,
        status: PrismaAdvancedReportRequestStatus.QUEUED,
        createdAt: new Date("2026-02-11T09:00:00.000Z"),
      },
    });
    await prisma.advancedReportRequest.create({
      data: {
        channelId: runningChannel.id,
        requestedByUserId: firstMissingManager.id,
        status: PrismaAdvancedReportRequestStatus.RUNNING,
        createdAt: new Date("2026-02-12T09:00:00.000Z"),
      },
    });
    await prisma.advancedReportRequest.create({
      data: {
        channelId: failedChannel.id,
        requestedByUserId: firstMissingManager.id,
        status: PrismaAdvancedReportRequestStatus.FAILED,
        lastError: "Provider rejected request",
        createdAt: new Date("2026-02-13T09:00:00.000Z"),
      },
    });

    const completedBatch = await createImportBatch({
      requestedByUserId: admin.id,
      fileName: "completed.csv",
      status: PrismaCsvImportBatchStatus.COMPLETED,
      createdAt: new Date("2026-03-05T09:00:00.000Z"),
      importedRowCount: 10,
    });
    await createImportBatch({
      requestedByUserId: admin.id,
      fileName: "queued.csv",
      status: PrismaCsvImportBatchStatus.QUEUED,
      createdAt: new Date("2026-03-01T09:00:00.000Z"),
    });
    await createImportBatch({
      requestedByUserId: admin.id,
      fileName: "running.csv",
      status: PrismaCsvImportBatchStatus.RUNNING,
      createdAt: new Date("2026-03-02T09:00:00.000Z"),
    });
    const failedBatch = await createImportBatch({
      requestedByUserId: admin.id,
      fileName: "failed.csv",
      status: PrismaCsvImportBatchStatus.FAILED,
      createdAt: new Date("2026-03-03T09:00:00.000Z"),
      failedRowCount: 2,
      lastError: "CSV row parsing failed",
    });

    const dashboard = await getCore().getAdminDashboardSummary();

    expect(dashboard.approvals.counts).toEqual({
      pendingApproval: 6,
      approved: 1,
      queued: 1,
      running: 1,
      failed: 1,
    });
    expect(dashboard.approvals.pendingPreview).toHaveLength(5);
    expect(dashboard.approvals.pendingPreview.map((request) => request.channel.title)).toEqual([
      "Pending Channel 1",
      "Pending Channel 2",
      "Pending Channel 3",
      "Pending Channel 4",
      "Pending Channel 5",
    ]);
    expect(dashboard.approvals.pendingPreview[0]?.lastCompletedReport).toMatchObject({
      requestId: priorCompleted.id,
      withinFreshWindow: true,
    });
    expect(dashboard.approvals.pendingPreview[0]?.lastCompletedReport?.ageDays).toEqual(expect.any(Number));

    expect(dashboard.imports.counts).toEqual({
      queued: 1,
      running: 1,
      failed: 1,
    });
    expect(dashboard.imports.attentionPreview).toHaveLength(3);
    expect(dashboard.imports.attentionPreview.map((batch) => batch.fileName)).toEqual([
      "failed.csv",
      "running.csv",
      "queued.csv",
    ]);
    expect(dashboard.imports.attentionPreview.some((batch) => batch.id === completedBatch.id)).toBe(false);
    expect(dashboard.imports.attentionPreview[0]?.id).toBe(failedBatch.id);

    expect(dashboard.users).toMatchObject({
      totalCount: 9,
      activeCount: 8,
      adminCount: 1,
      missingYoutubeKeyCount: 6,
    });
    expect(dashboard.users.missingYoutubeKeyPreview).toHaveLength(5);
    expect(dashboard.users.missingYoutubeKeyPreview.map((user) => user.email)).toEqual([
      "manager-1@example.com",
      "manager-2@example.com",
      "manager-3@example.com",
      "manager-4@example.com",
      "manager-5@example.com",
    ]);
    expect(
      dashboard.users.missingYoutubeKeyPreview.some(
        (user) => user.email === "inactive-manager@example.com",
      ),
    ).toBe(false);
  });

  it("returns empty actionable previews when there is no current work", async () => {
    const manager = await createUser({
      email: "manager@example.com",
      createdAt: new Date("2026-01-01T09:00:00.000Z"),
    });

    await assignYoutubeKey(manager.id);

    const dashboard = await getCore().getAdminDashboardSummary();

    expect(dashboard.approvals.counts).toEqual({
      pendingApproval: 0,
      approved: 0,
      queued: 0,
      running: 0,
      failed: 0,
    });
    expect(dashboard.approvals.pendingPreview).toEqual([]);
    expect(dashboard.imports.counts).toEqual({
      queued: 0,
      running: 0,
      failed: 0,
    });
    expect(dashboard.imports.attentionPreview).toEqual([]);
    expect(dashboard.users).toMatchObject({
      totalCount: 1,
      activeCount: 1,
      adminCount: 0,
      missingYoutubeKeyCount: 0,
    });
    expect(dashboard.users.missingYoutubeKeyPreview).toEqual([]);
  });
});
