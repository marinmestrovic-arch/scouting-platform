import {
  AdvancedReportRequestStatus as PrismaAdvancedReportRequestStatus,
  ChannelInsightSource as PrismaChannelInsightSource,
  PrismaClient,
  Role,
} from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ADVANCED_REPORT_FRESH_WINDOW_DAYS } from "./approvals/status";

const fetchHypeAuditorChannelInsightsMock = vi.fn();

vi.mock("@scouting-platform/integrations", async () => {
  const actual = await vi.importActual<typeof import("@scouting-platform/integrations")>(
    "@scouting-platform/integrations",
  );

  return {
    ...actual,
    fetchHypeAuditorChannelInsights: fetchHypeAuditorChannelInsightsMock,
  };
});

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type CoreModule = typeof import("./index");

const COMPLETED_INSIGHTS = {
  audienceCountries: [
    {
      countryCode: "US",
      countryName: "United States",
      percentage: 32.5,
    },
  ],
  audienceGenderAge: [
    {
      gender: "female",
      ageRange: "18-24",
      percentage: 21.5,
    },
  ],
  audienceInterests: [
    {
      label: "Gaming",
      score: 0.88,
    },
  ],
  estimatedPrice: {
    currencyCode: "USD",
    min: 500,
    max: 900,
  },
  brandMentions: [
    {
      brandName: "Nike",
    },
  ],
} as const;

const STORED_HYPEAUDITOR_RAW_PAYLOAD = {
  report: {
    report_state: "READY",
    report: {
      video_integration_price: {
        data: {
          currency_code: "usd",
          min: 500,
          max: 900,
        },
      },
      features: {
        audience_geo: {
          data: [
            { title: "us", prc: 32.5 },
            { title: "hr", prc: "18.4" },
          ],
        },
        audience_age_gender: {
          data: {
            "18-24": {
              female: 21.5,
            },
          },
        },
        audience_interests: {
          data: [{ label: "Gaming", score: 0.88 }],
        },
      },
    },
  },
  brandMentions: {
    items: [{ title: "Nike" }],
  },
} as const;

integration("week 5 core integration", () => {
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
    process.env.HYPEAUDITOR_API_KEY = "auth-id:auth-token";

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.HYPEAUDITOR_API_KEY = "auth-id:auth-token";
    fetchHypeAuditorChannelInsightsMock.mockReset();
    vi.resetModules();

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

    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    core = await import("./index");
  });

  afterEach(async () => {
    await core?.stopAdvancedReportsQueue();
    core = null;
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterAll(async () => {
    await core?.stopAdvancedReportsQueue();
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
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

  async function createChannel(
    youtubeChannelId = "UC-HYPE-1",
    title = "Hype Channel",
  ): Promise<{ id: string }> {
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

  it("creates a pending request, audits it, and dedupes active requests", async () => {
    const user = await createUser("manager@example.com");
    const channel = await createChannel();

    const first = await getCore().requestAdvancedReport({
      channelId: channel.id,
      requestedByUserId: user.id,
    });
    const second = await getCore().requestAdvancedReport({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    expect(first.advancedReport.status).toBe("pending_approval");
    expect(second.advancedReport.status).toBe("pending_approval");
    expect(first.advancedReport.requestId).toBe(second.advancedReport.requestId);

    const requests = await prisma.advancedReportRequest.findMany();
    expect(requests).toHaveLength(1);

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        action: "advanced_report.requested",
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents[0]?.metadata).toMatchObject({ created: true });
    expect(auditEvents[1]?.metadata).toMatchObject({
      created: false,
      reusedStatus: "pending_approval",
    });
  });

  it("allows a new request while surfacing the last completed report age and freshness", async () => {
    const user = await createUser("manager@example.com");
    const channel = await createChannel();
    const recentCompletedAt = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const completedRequest = await prisma.advancedReportRequest.create({
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

    const requested = await getCore().requestAdvancedReport({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    expect(requested.advancedReport.requestId).not.toBe(completedRequest.id);
    expect(requested.advancedReport.status).toBe("pending_approval");
    expect(requested.advancedReport.lastCompletedReport).toMatchObject({
      requestId: completedRequest.id,
      completedAt: recentCompletedAt.toISOString(),
      withinFreshWindow: true,
    });
    expect(requested.advancedReport.lastCompletedReport?.ageDays).toBeTypeOf("number");

    const requestCount = await prisma.advancedReportRequest.count();
    expect(requestCount).toBe(2);
  });

  it("approves queued work, records audit, and enqueues channels.enrich.hypeauditor", async () => {
    const user = await createUser("manager@example.com");
    const admin = await createUser("admin@example.com", Role.ADMIN);
    const channel = await createChannel();

    const created = await getCore().requestAdvancedReport({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    if (!created.advancedReport.requestId) {
      throw new Error("Expected request id");
    }

    const approved = await getCore().approveAdvancedReportRequest({
      advancedReportRequestId: created.advancedReport.requestId,
      actorUserId: admin.id,
      decisionNote: "Approved for paid lookup.",
    });

    expect(approved.status).toBe("queued");
    expect(approved.decisionNote).toBe("Approved for paid lookup.");
    expect(approved.reviewedBy?.id).toBe(admin.id);
    expect(approved.lastCompletedReport).toBeNull();

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        action: "advanced_report.approved",
        entityId: created.advancedReport.requestId,
      },
    });
    expect(auditEvent).not.toBeNull();

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'channels.enrich.hypeauditor'
    `;
    expect(jobs[0]?.count).toBe(1);
  });

  it("rejects pending requests and records audit metadata", async () => {
    const user = await createUser("manager@example.com");
    const admin = await createUser("admin@example.com", Role.ADMIN);
    const channel = await createChannel();

    const created = await getCore().requestAdvancedReport({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    if (!created.advancedReport.requestId) {
      throw new Error("Expected request id");
    }

    const rejected = await getCore().rejectAdvancedReportRequest({
      advancedReportRequestId: created.advancedReport.requestId,
      actorUserId: admin.id,
      decisionNote: "Out of budget this week.",
    });

    expect(rejected.status).toBe("rejected");
    expect(rejected.decisionNote).toBe("Out of budget this week.");

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        action: "advanced_report.rejected",
        entityId: created.advancedReport.requestId,
      },
    });
    expect(auditEvent).not.toBeNull();
  });

  it("executes queued work, stores raw payload and normalized insights, and completes the request", async () => {
    const user = await createUser("manager@example.com");
    const channel = await createChannel();
    const request = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.QUEUED,
      },
      select: {
        id: true,
      },
    });

    fetchHypeAuditorChannelInsightsMock.mockResolvedValue({
      insights: COMPLETED_INSIGHTS,
      rawPayload: {
        report: {
          report_state: "finished",
        },
        brandMentions: {
          items: [{ title: "Nike" }],
        },
      },
    });

    await getCore().executeAdvancedReportRequest({
      advancedReportRequestId: request.id,
      requestedByUserId: user.id,
    });

    const completedRequest = await prisma.advancedReportRequest.findUniqueOrThrow({
      where: {
        id: request.id,
      },
    });
    expect(completedRequest.status).toBe(PrismaAdvancedReportRequestStatus.COMPLETED);
    expect(completedRequest.providerPayloadId).not.toBeNull();
    expect(completedRequest.lastError).toBeNull();

    const payloadRow = await prisma.channelProviderPayload.findUniqueOrThrow({
      where: {
        id: completedRequest.providerPayloadId!,
      },
    });
    expect(payloadRow.provider).toBe("HYPEAUDITOR");

    const insightRow = await prisma.channelInsight.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(insightRow.audienceCountries).toEqual(COMPLETED_INSIGHTS.audienceCountries);
    expect(insightRow.estimatedPriceCurrencyCode).toBe("USD");
    expect(insightRow.brandMentions).toEqual(COMPLETED_INSIGHTS.brandMentions);

    const detail = await getCore().getChannelById(channel.id);
    expect(detail?.advancedReport.status).toBe("completed");
    expect(detail?.advancedReport.lastCompletedReport).toMatchObject({
      requestId: request.id,
      withinFreshWindow: true,
    });
    expect(detail?.advancedReport.lastCompletedReport?.ageDays).toBeTypeOf("number");
    expect(detail?.insights.audienceCountries).toEqual(COMPLETED_INSIGHTS.audienceCountries);
    expect(detail?.insights.brandMentions).toEqual(COMPLETED_INSIGHTS.brandMentions);
  });

  it("preserves higher precedence insight fields while still updating hype-owned fields", async () => {
    const user = await createUser("manager@example.com");
    const channel = await createChannel();
    const request = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.QUEUED,
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
            countryCode: "DE",
            countryName: "Germany",
            percentage: 77,
          },
        ],
        audienceCountriesSource: PrismaChannelInsightSource.CSV_IMPORT,
        audienceCountriesSourceUpdatedAt: new Date("2026-03-01T00:00:00.000Z"),
        brandMentions: [
          {
            brandName: "Legacy Brand",
          },
        ],
        brandMentionsSource: PrismaChannelInsightSource.HYPEAUDITOR,
        brandMentionsSourceUpdatedAt: new Date("2026-03-01T00:00:00.000Z"),
      },
    });

    fetchHypeAuditorChannelInsightsMock.mockResolvedValue({
      insights: COMPLETED_INSIGHTS,
      rawPayload: {
        report: {
          report_state: "finished",
        },
        brandMentions: {
          items: [{ title: "Nike" }],
        },
      },
    });

    await getCore().executeAdvancedReportRequest({
      advancedReportRequestId: request.id,
      requestedByUserId: user.id,
    });

    const insightRow = await prisma.channelInsight.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(insightRow.audienceCountries).toEqual([
      {
        countryCode: "DE",
        countryName: "Germany",
        percentage: 77,
      },
    ]);
    expect(insightRow.audienceCountriesSource).toBe(PrismaChannelInsightSource.CSV_IMPORT);
    expect(insightRow.brandMentions).toEqual(COMPLETED_INSIGHTS.brandMentions);
  });

  it("persists lastError when execution fails", async () => {
    const user = await createUser("manager@example.com");
    const channel = await createChannel();
    const request = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.QUEUED,
      },
      select: {
        id: true,
      },
    });

    fetchHypeAuditorChannelInsightsMock.mockRejectedValue(new Error("provider boom"));

    await expect(
      getCore().executeAdvancedReportRequest({
        advancedReportRequestId: request.id,
        requestedByUserId: user.id,
      }),
    ).rejects.toThrow("provider boom");

    const failedRequest = await prisma.advancedReportRequest.findUniqueOrThrow({
      where: {
        id: request.id,
      },
    });
    expect(failedRequest.status).toBe(PrismaAdvancedReportRequestStatus.FAILED);
    expect(failedRequest.lastError).toBe("provider boom");
  });

  it("skips HypeAuditor when providerPayloadId is already set", async () => {
    const user = await createUser("manager@example.com");
    const channel = await createChannel("UC-HYPE-REUSE", "Reuse Channel");
    const payload = await prisma.channelProviderPayload.create({
      data: {
        channelId: channel.id,
        provider: "HYPEAUDITOR",
        payload: STORED_HYPEAUDITOR_RAW_PAYLOAD,
      },
      select: {
        id: true,
      },
    });
    const request = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.QUEUED,
        providerPayloadId: payload.id,
      },
      select: {
        id: true,
      },
    });

    await getCore().executeAdvancedReportRequest({
      advancedReportRequestId: request.id,
      requestedByUserId: user.id,
    });

    expect(fetchHypeAuditorChannelInsightsMock).not.toHaveBeenCalled();

    const completedRequest = await prisma.advancedReportRequest.findUniqueOrThrow({
      where: {
        id: request.id,
      },
    });
    expect(completedRequest.status).toBe(PrismaAdvancedReportRequestStatus.COMPLETED);
  });

  it("sets nextProviderAttemptAt on REPORT_NOT_READY", async () => {
    const user = await createUser("manager@example.com");
    const channel = await createChannel("UC-HYPE-NOT-READY", "Not Ready Channel");
    const request = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.QUEUED,
      },
      select: {
        id: true,
      },
    });
    const { HypeAuditorError } = await import("@scouting-platform/integrations");

    fetchHypeAuditorChannelInsightsMock.mockRejectedValue(
      new HypeAuditorError(
        "HYPEAUDITOR_REPORT_NOT_READY",
        503,
        "HypeAuditor report is still processing",
      ),
    );

    const before = Date.now();

    await expect(
      getCore().executeAdvancedReportRequest({
        advancedReportRequestId: request.id,
        requestedByUserId: user.id,
      }),
    ).rejects.toMatchObject({
      code: "HYPEAUDITOR_REPORT_NOT_READY",
      status: 503,
    });

    const failedRequest = await prisma.advancedReportRequest.findUniqueOrThrow({
      where: {
        id: request.id,
      },
    });
    expect(failedRequest.status).toBe(PrismaAdvancedReportRequestStatus.FAILED);
    expect(failedRequest.nextProviderAttemptAt).not.toBeNull();
    expect(failedRequest.nextProviderAttemptAt!.getTime()).toBeGreaterThanOrEqual(
      before + 4 * 60 * 1000,
    );
    expect(failedRequest.nextProviderAttemptAt!.getTime()).toBeLessThanOrEqual(
      before + 6 * 60 * 1000,
    );
  });

  it("respects cooldown when nextProviderAttemptAt is in the future", async () => {
    const user = await createUser("manager@example.com");
    const channel = await createChannel("UC-HYPE-COOLDOWN", "Cooldown Channel");
    const request = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.QUEUED,
        nextProviderAttemptAt: new Date(Date.now() + 60_000),
      },
      select: {
        id: true,
      },
    });

    await expect(
      getCore().executeAdvancedReportRequest({
        advancedReportRequestId: request.id,
        requestedByUserId: user.id,
      }),
    ).rejects.toMatchObject({
      code: "HYPEAUDITOR_COOLDOWN_ACTIVE",
      status: 429,
    });

    expect(fetchHypeAuditorChannelInsightsMock).not.toHaveBeenCalled();

    const failedRequest = await prisma.advancedReportRequest.findUniqueOrThrow({
      where: {
        id: request.id,
      },
    });
    expect(failedRequest.status).toBe(PrismaAdvancedReportRequestStatus.FAILED);
    expect(failedRequest.lastError).toBe(
      "HypeAuditor cooldown active — retry after nextProviderAttemptAt",
    );
  });

  it("sets lastProviderAttemptAt on successful attempt", async () => {
    const user = await createUser("manager@example.com");
    const channel = await createChannel("UC-HYPE-ATTEMPT", "Attempt Channel");
    const request = await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.QUEUED,
      },
      select: {
        id: true,
      },
    });

    fetchHypeAuditorChannelInsightsMock.mockResolvedValue({
      insights: COMPLETED_INSIGHTS,
      rawPayload: STORED_HYPEAUDITOR_RAW_PAYLOAD,
    });

    await getCore().executeAdvancedReportRequest({
      advancedReportRequestId: request.id,
      requestedByUserId: user.id,
    });

    const completedRequest = await prisma.advancedReportRequest.findUniqueOrThrow({
      where: {
        id: request.id,
      },
    });
    expect(completedRequest.lastProviderAttemptAt).not.toBeNull();
  });

  it("surfaces stale completed reports on channel detail after 120 days", async () => {
    const user = await createUser("manager@example.com");
    const channel = await createChannel();
    const staleCompletedAt = new Date(
      Date.now() - (ADVANCED_REPORT_FRESH_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000,
    );

    await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: user.id,
        status: PrismaAdvancedReportRequestStatus.COMPLETED,
        completedAt: staleCompletedAt,
      },
    });

    const detail = await getCore().getChannelById(channel.id);
    expect(detail?.advancedReport.status).toBe("stale");
    expect(detail?.advancedReport.lastCompletedReport).toMatchObject({
      completedAt: staleCompletedAt.toISOString(),
      withinFreshWindow: false,
    });
    expect(detail?.advancedReport.lastCompletedReport?.ageDays).toBeGreaterThan(
      ADVANCED_REPORT_FRESH_WINDOW_DAYS,
    );
  });
});
