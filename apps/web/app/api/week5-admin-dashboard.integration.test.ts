import {
  AdvancedReportRequestStatus as PrismaAdvancedReportRequestStatus,
  CredentialProvider,
  CsvImportBatchStatus as PrismaCsvImportBatchStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { adminDashboardResponseSchema } from "@scouting-platform/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;

let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

integration("week 5 admin dashboard API integration", () => {
  let prisma: PrismaClient;
  let dashboardRoute: typeof import("./admin/dashboard/route");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "week5-admin-dashboard-auth-secret";

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    await prisma.$connect();
    dashboardRoute = await import("./admin/dashboard/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;

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
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

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

  it("enforces admin-only access", async () => {
    const admin = await createUser("admin@example.com", Role.ADMIN);
    const user = await createUser("manager@example.com", Role.USER);

    currentSessionUser = null;
    const unauthorized = await dashboardRoute.GET();
    expect(unauthorized.status).toBe(401);

    currentSessionUser = { id: user.id, role: "user" };
    const forbidden = await dashboardRoute.GET();
    expect(forbidden.status).toBe(403);

    currentSessionUser = { id: admin.id, role: "admin" };
    const allowed = await dashboardRoute.GET();
    expect(allowed.status).toBe(200);
  });

  it("returns the aggregated admin dashboard summary for admins", async () => {
    const admin = await createUser("admin@example.com", Role.ADMIN);
    const missingManager = await createUser("missing-key@example.com", Role.USER);
    const keyedManager = await createUser("keyed-manager@example.com", Role.USER);
    await assignYoutubeKey(keyedManager.id);

    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-DASH-API-1",
        title: "API Pending Channel",
      },
      select: {
        id: true,
      },
    });

    await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: missingManager.id,
        status: PrismaAdvancedReportRequestStatus.PENDING_APPROVAL,
      },
    });

    await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: missingManager.id,
        status: PrismaAdvancedReportRequestStatus.RUNNING,
      },
    });

    await prisma.csvImportBatch.create({
      data: {
        requestedByUserId: admin.id,
        fileName: "failed.csv",
        templateVersion: "v1",
        status: PrismaCsvImportBatchStatus.FAILED,
        totalRowCount: 6,
        importedRowCount: 4,
        failedRowCount: 2,
        lastError: "CSV row failed validation",
      },
    });

    currentSessionUser = { id: admin.id, role: "admin" };

    const response = await dashboardRoute.GET();

    expect(response.status).toBe(200);
    const payload = adminDashboardResponseSchema.parse(await response.json());

    expect(payload.approvals.counts).toEqual({
      pendingApproval: 1,
      approved: 0,
      queued: 0,
      running: 1,
      failed: 0,
    });
    expect(payload.approvals.pendingPreview[0]?.channel.title).toBe("API Pending Channel");
    expect(payload.imports.counts).toEqual({
      queued: 0,
      running: 0,
      failed: 1,
    });
    expect(payload.imports.attentionPreview[0]?.fileName).toBe("failed.csv");
    expect(payload.users).toMatchObject({
      totalCount: 3,
      activeCount: 3,
      adminCount: 1,
      missingYoutubeKeyCount: 1,
    });
    expect(payload.users.missingYoutubeKeyPreview[0]?.email).toBe("missing-key@example.com");
  });
});
