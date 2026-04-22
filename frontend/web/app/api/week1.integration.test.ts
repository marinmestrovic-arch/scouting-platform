import { randomUUID } from "node:crypto";

import {
  AdvancedReportRequestStatus,
  ChannelEnrichmentStatus,
  CredentialProvider,
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

integration("week 1 API integration", () => {
  let prisma: PrismaClient;
  let adminUsersRoute: typeof import("./admin/users/route");
  let adminPasswordRoute: typeof import("./admin/users/[id]/password/route");
  let adminYoutubeKeyRoute: typeof import("./admin/users/[id]/youtube-key/route");
  let channelsRoute: typeof import("./channels/route");
  let channelDetailRoute: typeof import("./channels/[id]/route");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.APP_ENCRYPTION_KEY = "12345678901234567890123456789012";
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "week1-integration-auth-secret";

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
    adminUsersRoute = await import("./admin/users/route");
    adminPasswordRoute = await import("./admin/users/[id]/password/route");
    adminYoutubeKeyRoute = await import("./admin/users/[id]/youtube-key/route");
    channelsRoute = await import("./channels/route");
    channelDetailRoute = await import("./channels/[id]/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        advanced_report_requests,
        channel_enrichments,
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

  async function createAdminUser(email = "admin@example.com"): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email,
        name: "Admin",
        role: Role.ADMIN,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  it("creates user via POST /api/admin/users", async () => {
    const admin = await createAdminUser();
    currentSessionUser = { id: admin.id, role: "admin" };

    const response = await adminUsersRoute.POST(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "campaign@example.com",
          name: "Campaign User",
          role: "user",
          password: "StrongPassword123",
        }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.email).toBe("campaign@example.com");
    expect(payload.role).toBe("user");
    expect(payload.youtubeKeyAssigned).toBe(false);

    const created = await prisma.user.findUnique({
      where: {
        email: "campaign@example.com",
      },
    });
    expect(created).not.toBeNull();
    if (!created) {
      throw new Error("Expected created user to exist");
    }
    expect(created.passwordHash).not.toBe("StrongPassword123");

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        action: "user.created",
        entityId: created.id,
      },
    });
    expect(auditEvent).not.toBeNull();
  });

  it("returns 409 for duplicate admin-created email", async () => {
    const admin = await createAdminUser();
    currentSessionUser = { id: admin.id, role: "admin" };

    await prisma.user.create({
      data: {
        email: "existing@example.com",
        name: "Existing User",
        role: Role.USER,
        passwordHash: "existing-hash",
        isActive: true,
      },
    });

    const response = await adminUsersRoute.POST(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "existing@example.com",
          name: "Another User",
          role: "user",
          password: "StrongPassword123",
        }),
      }),
    );

    expect(response.status).toBe(409);
  });

  it("blocks non-admin and unauthenticated access to admin endpoints", async () => {
    const admin = await createAdminUser();
    const campaignUser = await prisma.user.create({
      data: {
        email: "user@example.com",
        name: "Campaign User",
        role: Role.USER,
        passwordHash: "user-hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    currentSessionUser = null;
    const unauthenticated = await adminUsersRoute.GET();
    expect(unauthenticated.status).toBe(401);

    currentSessionUser = { id: campaignUser.id, role: "user" };
    const forbidden = await adminUsersRoute.GET();
    expect(forbidden.status).toBe(403);

    currentSessionUser = { id: admin.id, role: "admin" };
    const allowed = await adminUsersRoute.GET();
    expect(allowed.status).toBe(200);
  });

  it("updates user password and records audit event", async () => {
    const admin = await createAdminUser();
    const campaignUser = await prisma.user.create({
      data: {
        email: "user@example.com",
        name: "Campaign User",
        role: Role.USER,
        passwordHash: "old-hash",
        isActive: true,
      },
    });

    currentSessionUser = { id: admin.id, role: "admin" };

    const response = await adminPasswordRoute.PUT(
      new Request(`http://localhost/api/admin/users/${campaignUser.id}/password`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: "NewStrongPassword123",
        }),
      }),
      { params: Promise.resolve({ id: campaignUser.id }) },
    );

    expect(response.status).toBe(200);
    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: campaignUser.id },
    });
    expect(updated.passwordHash).not.toBe("old-hash");

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        action: "user.password.updated",
        entityId: campaignUser.id,
      },
    });
    expect(auditEvent).not.toBeNull();
  });

  it("stores encrypted YouTube key via admin endpoint", async () => {
    const admin = await createAdminUser();
    const campaignUser = await prisma.user.create({
      data: {
        email: "user@example.com",
        name: "Campaign User",
        role: Role.USER,
        passwordHash: "user-hash",
        isActive: true,
      },
    });

    currentSessionUser = { id: admin.id, role: "admin" };

    const response = await adminYoutubeKeyRoute.PUT(
      new Request(`http://localhost/api/admin/users/${campaignUser.id}/youtube-key`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          youtubeApiKey: "yt-secret-key",
        }),
      }),
      { params: Promise.resolve({ id: campaignUser.id }) },
    );

    expect(response.status).toBe(200);

    const credential = await prisma.userProviderCredential.findUnique({
      where: {
        userId_provider: {
          userId: campaignUser.id,
          provider: CredentialProvider.YOUTUBE_DATA_API,
        },
      },
    });

    expect(credential).not.toBeNull();
    expect(credential?.encryptedSecret).not.toBe("yt-secret-key");
    expect(credential?.keyVersion).toBe(1);

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        action: "user.youtube_key.updated",
        entityId: campaignUser.id,
      },
    });
    expect(auditEvent).not.toBeNull();
  });

  it("returns empty-safe channel list and 404 for missing detail", async () => {
    const user = await prisma.user.create({
      data: {
        email: "user@example.com",
        name: "Campaign User",
        role: Role.USER,
        passwordHash: "user-hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
    currentSessionUser = { id: user.id, role: "user" };

    const listResponse = await channelsRoute.GET(
      new Request("http://localhost/api/channels?page=1&pageSize=20"),
    );

    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.items).toEqual([]);
    expect(listPayload.total).toBe(0);

    const detailResponse = await channelDetailRoute.GET(
      new Request(`http://localhost/api/channels/${randomUUID()}`),
      { params: Promise.resolve({ id: randomUUID() }) },
    );
    expect(detailResponse.status).toBe(404);
  });

  it("filters GET /api/channels by search and repeated status params", async () => {
    const user = await prisma.user.create({
      data: {
        email: "user@example.com",
        name: "Campaign User",
        role: Role.USER,
        passwordHash: "user-hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    const filteredChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_FILTER_MATCH",
        title: "Space Match",
      },
      select: {
        id: true,
      },
    });
    await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_FILTER_SKIP",
        title: "Skip me",
      },
    });

    await prisma.channelEnrichment.create({
      data: {
        channelId: filteredChannel.id,
        status: ChannelEnrichmentStatus.FAILED,
        requestedByUserId: user.id,
        requestedAt: new Date("2026-03-09T10:00:00.000Z"),
        lastError: "quota",
      },
    });
    await prisma.advancedReportRequest.create({
      data: {
        channelId: filteredChannel.id,
        requestedByUserId: user.id,
        status: AdvancedReportRequestStatus.PENDING_APPROVAL,
      },
    });

    currentSessionUser = { id: user.id, role: "user" };

    const response = await channelsRoute.GET(
      new Request(
        "http://localhost/api/channels?page=1&pageSize=20&query=space&enrichmentStatus=failed&advancedReportStatus=pending_approval",
      ),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.youtubeChannelId).toBe("UC_FILTER_MATCH");
  });

  it("filters GET /api/channels by creator fields and YouTube metric ranges", async () => {
    const user = await prisma.user.create({
      data: {
        email: "user@example.com",
        name: "Campaign User",
        role: Role.USER,
        passwordHash: "user-hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    const filteredChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_CREATOR_FILTER_MATCH",
        title: "Creator Filter Match",
        countryRegion: "Croatia",
        influencerVertical: "Gaming",
        influencerType: "Creator",
        metrics: {
          create: {
            youtubeFollowers: 500000n,
            youtubeVideoMedianViews: 220000n,
            youtubeShortsMedianViews: 180000n,
          },
        },
      },
    });
    await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_CREATOR_FILTER_SKIP",
        title: "Creator Filter Skip",
        countryRegion: "Croatia",
        influencerVertical: "Gaming",
        influencerType: "Creator",
        metrics: {
          create: {
            youtubeFollowers: 200000n,
            youtubeVideoMedianViews: 120000n,
            youtubeShortsMedianViews: 80000n,
          },
        },
      },
    });

    currentSessionUser = { id: user.id, role: "user" };

    const response = await channelsRoute.GET(
      new Request(
        "http://localhost/api/channels?page=1&pageSize=20&countryRegion=Croatia&countryRegion=Germany&influencerVertical=Gaming&influencerType=Creator&youtubeVideoMedianViewsMin=200000&youtubeVideoMedianViewsMax=250000&youtubeShortsMedianViewsMin=100000&youtubeShortsMedianViewsMax=200000&youtubeFollowersMin=400000&youtubeFollowersMax=600000",
      ),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      id: filteredChannel.id,
      youtubeChannelId: "UC_CREATOR_FILTER_MATCH",
      youtubeFollowers: "500000",
      youtubeVideoMedianViews: "220000",
      youtubeShortsMedianViews: "180000",
    });
  });

  it("returns 400 for invalid channel filter params", async () => {
    const user = await prisma.user.create({
      data: {
        email: "user@example.com",
        name: "Campaign User",
        role: Role.USER,
        passwordHash: "user-hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
    currentSessionUser = { id: user.id, role: "user" };

    const response = await channelsRoute.GET(
      new Request(
        "http://localhost/api/channels?page=1&pageSize=20&enrichmentStatus=not-a-status",
      ),
    );

    expect(response.status).toBe(400);
  });
});
