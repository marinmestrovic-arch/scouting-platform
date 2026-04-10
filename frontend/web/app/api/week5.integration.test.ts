import {
  AdvancedReportRequestStatus as PrismaAdvancedReportRequestStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;

let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

integration("week 5 API integration", () => {
  let prisma: PrismaClient;
  let channelRequestRoute: typeof import("./channels/[id]/advanced-report-requests/route");
  let adminRequestsRoute: typeof import("./admin/advanced-report-requests/route");
  let adminRequestDetailRoute: typeof import("./admin/advanced-report-requests/[id]/route");
  let adminApproveRoute: typeof import("./admin/advanced-report-requests/[id]/approve/route");
  let adminRejectRoute: typeof import("./admin/advanced-report-requests/[id]/reject/route");
  let channelDetailRoute: typeof import("./channels/[id]/route");
  let core: typeof import("@scouting-platform/core");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "week5-integration-auth-secret";

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
    core = await import("@scouting-platform/core");
    channelRequestRoute = await import("./channels/[id]/advanced-report-requests/route");
    adminRequestsRoute = await import("./admin/advanced-report-requests/route");
    adminRequestDetailRoute = await import("./admin/advanced-report-requests/[id]/route");
    adminApproveRoute = await import("./admin/advanced-report-requests/[id]/approve/route");
    adminRejectRoute = await import("./admin/advanced-report-requests/[id]/reject/route");
    channelDetailRoute = await import("./channels/[id]/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
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
      DELETE FROM pgboss.job WHERE name = 'channels.enrich.hypeauditor'
    `);
  });

  afterAll(async () => {
    await core.stopAdvancedReportsQueue();
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

  it("returns 202 from POST /api/channels/:id/advanced-report-requests for authenticated users", async () => {
    const user = await createUser("manager@example.com");
    const recentCompletedAt = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-WEEK5-REQ",
        title: "Week 5 Request",
      },
      select: {
        id: true,
      },
    });
    const priorCompletedRequest = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.COMPLETED,
        completedAt: recentCompletedAt,
      },
      select: {
        id: true,
      },
    });

    currentSessionUser = { id: user.id, role: "user" };

    const response = await channelRequestRoute.POST(
      new Request(`http://localhost/api/channels/${channel.id}/advanced-report-requests`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: channel.id }) },
    );

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload.channelId).toBe(channel.id);
    expect(payload.advancedReport.status).toBe("pending_approval");
    expect(payload.advancedReport.requestId).toBeTruthy();
    expect(payload.advancedReport.requestId).not.toBe(priorCompletedRequest.id);
    expect(payload.advancedReport.lastCompletedReport).toMatchObject({
      requestId: priorCompletedRequest.id,
      completedAt: recentCompletedAt.toISOString(),
      withinFreshWindow: true,
    });
    expect(payload.advancedReport.lastCompletedReport.ageDays).toEqual(expect.any(Number));
  });

  it("supports admin list and approve/reject routes while enforcing admin-only access", async () => {
    const user = await createUser("manager@example.com");
    const admin = await createUser("admin@example.com", Role.ADMIN);
    const recentCompletedAt = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-WEEK5-ADMIN",
        title: "Week 5 Admin",
      },
      select: {
        id: true,
      },
    });
    const priorCompletedRequest = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.COMPLETED,
        completedAt: recentCompletedAt,
      },
      select: {
        id: true,
      },
    });
    const request = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.PENDING_APPROVAL,
      },
      select: {
        id: true,
      },
    });

    currentSessionUser = { id: user.id, role: "user" };
    const forbidden = await adminRequestsRoute.GET(
      new Request("http://localhost/api/admin/advanced-report-requests"),
    );
    expect(forbidden.status).toBe(403);

    currentSessionUser = { id: admin.id, role: "admin" };

    const listResponse = await adminRequestsRoute.GET(
      new Request("http://localhost/api/admin/advanced-report-requests"),
    );
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.items).toHaveLength(1);
    expect(listPayload.items[0]?.id).toBe(request.id);
    expect(listPayload.items[0]?.lastCompletedReport).toMatchObject({
      requestId: priorCompletedRequest.id,
      completedAt: recentCompletedAt.toISOString(),
      withinFreshWindow: true,
    });
    expect(listPayload.items[0]?.lastCompletedReport?.ageDays).toEqual(expect.any(Number));

    const approveResponse = await adminApproveRoute.POST(
      new Request(`http://localhost/api/admin/advanced-report-requests/${request.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decisionNote: "Approved for lookup.",
        }),
      }),
      { params: Promise.resolve({ id: request.id }) },
    );
    expect(approveResponse.status).toBe(200);
    const approvePayload = await approveResponse.json();
    expect(approvePayload.status).toBe("queued");
    expect(approvePayload.decisionNote).toBe("Approved for lookup.");
    expect(approvePayload.lastCompletedReport).toMatchObject({
      requestId: priorCompletedRequest.id,
      completedAt: recentCompletedAt.toISOString(),
      withinFreshWindow: true,
    });

    const rejectedRequest = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.PENDING_APPROVAL,
      },
      select: {
        id: true,
      },
    });

    const rejectResponse = await adminRejectRoute.POST(
      new Request(`http://localhost/api/admin/advanced-report-requests/${rejectedRequest.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decisionNote: "Not approved.",
        }),
      }),
      { params: Promise.resolve({ id: rejectedRequest.id }) },
    );
    expect(rejectResponse.status).toBe(200);
    const rejectPayload = await rejectResponse.json();
    expect(rejectPayload.status).toBe("rejected");
    expect(rejectPayload.lastCompletedReport).toMatchObject({
      requestId: priorCompletedRequest.id,
      completedAt: recentCompletedAt.toISOString(),
      withinFreshWindow: true,
    });
  });

  it("returns rejected decision notes on manager channel detail", async () => {
    const user = await createUser("manager@example.com");
    const admin = await createUser("admin@example.com", Role.ADMIN);
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-WEEK5-REJECTED-DETAIL",
        title: "Week 5 Rejected Detail",
      },
      select: {
        id: true,
      },
    });
    const request = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.PENDING_APPROVAL,
      },
      select: {
        id: true,
      },
    });

    currentSessionUser = { id: admin.id, role: "admin" };

    const rejectResponse = await adminRejectRoute.POST(
      new Request(`http://localhost/api/admin/advanced-report-requests/${request.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decisionNote: "Out of budget this week.",
        }),
      }),
      { params: Promise.resolve({ id: request.id }) },
    );
    expect(rejectResponse.status).toBe(200);

    currentSessionUser = { id: user.id, role: "user" };

    const detailResponse = await channelDetailRoute.GET(
      new Request(`http://localhost/api/channels/${channel.id}`),
      { params: Promise.resolve({ id: channel.id }) },
    );

    expect(detailResponse.status).toBe(200);
    const detailPayload = await detailResponse.json();
    expect(detailPayload.advancedReport.status).toBe("rejected");
    expect(detailPayload.advancedReport.decisionNote).toBe("Out of budget this week.");
  });

  it("returns normalized insights on channel detail without exposing raw payload", async () => {
    const user = await createUser("manager@example.com");
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-WEEK5-DETAIL",
        title: "Week 5 Detail",
      },
      select: {
        id: true,
      },
    });
    const payload = await prisma.channelProviderPayload.create({
      data: {
        channelId: channel.id,
        provider: "HYPEAUDITOR",
        payload: {
          report: {
            report_state: "finished",
          },
        },
      },
      select: {
        id: true,
      },
    });

    await prisma.channelInsight.create({
      data: {
        channelId: channel.id,
        audienceCountries: [
          {
            countryCode: "US",
            countryName: "United States",
            percentage: 32.5,
          },
        ],
        audienceCountriesSource: "HYPEAUDITOR",
        audienceCountriesSourceUpdatedAt: new Date(),
        audienceGenderAge: [
          {
            gender: "female",
            ageRange: "18-24",
            percentage: 21.5,
          },
        ],
        audienceGenderAgeSource: "HYPEAUDITOR",
        audienceGenderAgeSourceUpdatedAt: new Date(),
        audienceInterests: [
          {
            label: "Gaming",
            score: 0.88,
          },
        ],
        audienceInterestsSource: "HYPEAUDITOR",
        audienceInterestsSourceUpdatedAt: new Date(),
        estimatedPriceCurrencyCode: "USD",
        estimatedPriceMin: 500,
        estimatedPriceMax: 900,
        estimatedPriceSource: "HYPEAUDITOR",
        estimatedPriceSourceUpdatedAt: new Date(),
        brandMentions: [
          {
            brandName: "Nike",
          },
        ],
        brandMentionsSource: "HYPEAUDITOR",
        brandMentionsSourceUpdatedAt: new Date(),
      },
    });

    const request = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.COMPLETED,
        completedAt: new Date(),
        providerPayloadId: payload.id,
      },
      select: {
        id: true,
      },
    });

    currentSessionUser = { id: user.id, role: "user" };

    const response = await channelDetailRoute.GET(
      new Request(`http://localhost/api/channels/${channel.id}`),
      { params: Promise.resolve({ id: channel.id }) },
    );

    expect(response.status).toBe(200);
    const detailPayload = await response.json();
    expect(detailPayload.advancedReport.requestId).toBe(request.id);
    expect(detailPayload.advancedReport.status).toBe("completed");
    expect(detailPayload.advancedReport.lastCompletedReport).toMatchObject({
      requestId: request.id,
      withinFreshWindow: true,
    });
    expect(detailPayload.advancedReport.lastCompletedReport.ageDays).toEqual(expect.any(Number));
    expect(detailPayload.insights.audienceCountries).toHaveLength(1);
    expect(detailPayload.insights.brandMentions[0]?.brandName).toBe("Nike");
    expect(detailPayload.rawPayload).toBeUndefined();
  });

  it("returns raw payload on admin request detail", async () => {
    const user = await createUser("manager@example.com");
    const admin = await createUser("admin@example.com", Role.ADMIN);
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-WEEK5-RAW",
        title: "Week 5 Raw",
      },
      select: {
        id: true,
      },
    });
    const payload = await prisma.channelProviderPayload.create({
      data: {
        channelId: channel.id,
        provider: "HYPEAUDITOR",
        payload: {
          report: {
            report_state: "finished",
          },
        },
      },
      select: {
        id: true,
      },
    });
    const request = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.COMPLETED,
        completedAt: new Date(),
        providerPayloadId: payload.id,
      },
      select: {
        id: true,
      },
    });

    currentSessionUser = { id: admin.id, role: "admin" };

    const response = await adminRequestDetailRoute.GET(
      new Request(`http://localhost/api/admin/advanced-report-requests/${request.id}`),
      { params: Promise.resolve({ id: request.id }) },
    );

    expect(response.status).toBe(200);
    const detailPayload = await response.json();
    expect(detailPayload.id).toBe(request.id);
    expect(detailPayload.lastCompletedReport).toMatchObject({
      requestId: request.id,
      withinFreshWindow: true,
    });
    expect(detailPayload.rawPayload).toEqual({
      report: {
        report_state: "finished",
      },
    });
  });
});
