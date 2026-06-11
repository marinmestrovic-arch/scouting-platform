import {
  CredentialProvider,
  PrismaClient,
  Role,
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;
type CoreModule = typeof import("@scouting-platform/core");

let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

integration("week 4 API integration", () => {
  let prisma: PrismaClient;
  let core: CoreModule;
  let channelsRoute: typeof import("./channels/route");
  let channelDetailRoute: typeof import("./channels/[id]/route");
  let channelEnrichRoute: typeof import("./channels/[id]/enrich/route");
  let channelBulkCancelRoute: typeof import("./channels/enrichment/bulk-cancel/route");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "week4-integration-auth-secret";
    process.env.APP_ENCRYPTION_KEY = "12345678901234567890123456789012";

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
    core = await import("@scouting-platform/core");
    channelsRoute = await import("./channels/route");
    channelDetailRoute = await import("./channels/[id]/route");
    channelEnrichRoute = await import("./channels/[id]/enrich/route");
    channelBulkCancelRoute = await import("./channels/enrichment/bulk-cancel/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
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
      DELETE FROM pgboss.job WHERE name = 'channels.enrich.llm'
    `);
  });

  afterAll(async () => {
    await core.stopRunsQueue();
    await prisma.$disconnect();
  });

  async function createUser(email: string, role: Role = Role.USER): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email,
        name: "User",
        role,
        passwordHash: "hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  it("returns 202 from POST /api/channels/:id/enrich when the requester has a youtube key", async () => {
    const user = await createUser("manager@example.com");
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-API-ENRICH-1",
        title: "Channel Name",
      },
      select: {
        id: true,
      },
    });
    await prisma.userProviderCredential.create({
      data: {
        userId: user.id,
        provider: CredentialProvider.YOUTUBE_DATA_API,
        encryptedSecret: "encrypted",
        encryptionIv: "iv",
        encryptionAuthTag: "tag",
        keyVersion: 1,
      },
    });

    currentSessionUser = { id: user.id, role: "user" };

    const response = await channelEnrichRoute.POST(
      new Request(`http://localhost/api/channels/${channel.id}/enrich`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: channel.id }) },
    );

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload.channelId).toBe(channel.id);
    expect(payload.enrichment.status).toBe("queued");
    expect(payload.enrichment.structuredProfile).toBeNull();

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'channels.enrich.llm'
    `;
    expect(jobs[0]?.count).toBe(1);
  });

  it("returns 400 from POST /api/channels/:id/enrich when the requester has no youtube key", async () => {
    const user = await createUser("manager@example.com");
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-API-ENRICH-2",
        title: "Channel Name",
      },
      select: {
        id: true,
      },
    });

    currentSessionUser = { id: user.id, role: "user" };

    const response = await channelEnrichRoute.POST(
      new Request(`http://localhost/api/channels/${channel.id}/enrich`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: channel.id }) },
    );

    expect(response.status).toBe(400);
  });

  it("cancels active enrichment through DELETE and records an audit event", async () => {
    const user = await createUser("cancel-manager@example.com");
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-API-CANCEL-1",
        title: "Cancelable Channel",
        enrichment: {
          create: {
            status: PrismaChannelEnrichmentStatus.RUNNING,
            requestedByUserId: user.id,
            requestedAt: new Date(),
            startedAt: new Date(),
          },
        },
      },
      select: {
        id: true,
      },
    });
    currentSessionUser = { id: user.id, role: "user" };

    const response = await channelEnrichRoute.DELETE(
      new Request(`http://localhost/api/channels/${channel.id}/enrich`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: channel.id }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      channelId: channel.id,
      enrichment: {
        status: "cancelled",
      },
    });
    await expect(prisma.channelEnrichment.findUnique({
      where: { channelId: channel.id },
      select: { status: true, lastError: true, nextRetryAt: true },
    })).resolves.toEqual({
      status: PrismaChannelEnrichmentStatus.CANCELLED,
      lastError: null,
      nextRetryAt: null,
    });
    await expect(prisma.auditEvent.findFirst({
      where: {
        action: "channel.enrichment.cancelled",
        entityId: channel.id,
      },
      select: { actorUserId: true, metadata: true },
    })).resolves.toMatchObject({
      actorUserId: user.id,
      metadata: { previousStatus: "running" },
    });
  });

  it("bulk cancels selected active enrichments and leaves terminal rows unchanged", async () => {
    const user = await createUser("bulk-cancel-manager@example.com");
    const activeChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-API-BULK-CANCEL-ACTIVE",
        title: "Active Channel",
        enrichment: {
          create: {
            status: PrismaChannelEnrichmentStatus.RUNNING,
            requestedByUserId: user.id,
            requestedAt: new Date(),
            startedAt: new Date(),
          },
        },
      },
      select: { id: true },
    });
    const completedChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-API-BULK-CANCEL-COMPLETED",
        title: "Completed Channel",
        enrichment: {
          create: {
            status: PrismaChannelEnrichmentStatus.COMPLETED,
            requestedByUserId: user.id,
            requestedAt: new Date(),
            completedAt: new Date(),
          },
        },
      },
      select: { id: true },
    });
    currentSessionUser = { id: user.id, role: "user" };

    const response = await channelBulkCancelRoute.POST(new Request(
      "http://localhost/api/channels/enrichment/bulk-cancel",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "selected",
          channelIds: [activeChannel.id, completedChannel.id],
        }),
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requestedCount: 2,
      cancelledCount: 1,
      notActiveCount: 1,
    });
    await expect(prisma.channelEnrichment.findUnique({
      where: { channelId: activeChannel.id },
      select: { status: true },
    })).resolves.toEqual({ status: PrismaChannelEnrichmentStatus.CANCELLED });
    await expect(prisma.channelEnrichment.findUnique({
      where: { channelId: completedChannel.id },
      select: { status: true },
    })).resolves.toEqual({ status: PrismaChannelEnrichmentStatus.COMPLETED });
  });

  it("includes enrichment state on channel list and detail responses", async () => {
    const user = await createUser("manager@example.com");
    currentSessionUser = { id: user.id, role: "user" };

    const missingChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-API-MISSING",
        title: "Missing Enrichment",
      },
      select: {
        id: true,
      },
    });
    const completedChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-API-COMPLETED",
        title: "Completed Enrichment",
      },
      select: {
        id: true,
      },
    });

    await prisma.$executeRawUnsafe(`
      UPDATE channels
      SET updated_at = now() - interval '2 days'
      WHERE id = '${completedChannel.id}'
    `);
    await prisma.channelEnrichment.create({
      data: {
        channelId: completedChannel.id,
        status: PrismaChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: user.id,
        requestedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        summary: "Creator focused on gaming commentary.",
        topics: ["gaming", "commentary"],
        brandFitNotes: "Strong fit for gaming peripherals.",
        confidence: 0.82,
        structuredProfile: {
          primaryNiche: "gaming",
          secondaryNiches: ["commentary_reaction"],
          contentFormats: ["long_form"],
          brandFitTags: ["gaming_hardware", "entertainment_media"],
          language: "English",
          geoHints: ["United States"],
          sponsorSignals: ["Peripheral reviews", "Game commentary"],
          brandSafety: {
            status: "low",
            flags: [],
            rationale: "Context is gaming-focused with no evident safety concerns in the stored sample.",
          },
        },
      },
    });

    const listResponse = await channelsRoute.GET(
      new Request("http://localhost/api/channels?page=1&pageSize=20"),
    );

    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    const missingItem = listPayload.items.find((item: { id: string }) => item.id === missingChannel.id);
    const completedItem = listPayload.items.find(
      (item: { id: string }) => item.id === completedChannel.id,
    );
    expect(missingItem?.enrichment.status).toBe("missing");
    expect(completedItem?.enrichment.status).toBe("completed");
    expect(completedItem?.enrichment.lastError).toBeNull();

    const detailResponse = await channelDetailRoute.GET(
      new Request(`http://localhost/api/channels/${completedChannel.id}`),
      { params: Promise.resolve({ id: completedChannel.id }) },
    );

    expect(detailResponse.status).toBe(200);
    const detailPayload = await detailResponse.json();
    expect(detailPayload.enrichment.status).toBe("completed");
    expect(detailPayload.enrichment.summary).toBe("Creator focused on gaming commentary.");
    expect(detailPayload.enrichment.topics).toEqual(["gaming", "commentary"]);
    expect(detailPayload.enrichment.brandFitNotes).toBe("Strong fit for gaming peripherals.");
    expect(detailPayload.enrichment.confidence).toBe(0.82);
    expect(detailPayload.enrichment.structuredProfile).toEqual({
      primaryNiche: "gaming",
      secondaryNiches: ["commentary_reaction"],
      contentFormats: ["long_form"],
      brandFitTags: ["gaming_hardware", "entertainment_media"],
      language: "English",
      geoHints: ["United States"],
      sponsorSignals: ["Peripheral reviews", "Game commentary"],
      brandSafety: {
        status: "low",
        flags: [],
        rationale: "Context is gaming-focused with no evident safety concerns in the stored sample.",
      },
    });
  });
});
