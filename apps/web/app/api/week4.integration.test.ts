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

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "week4-integration-auth-secret";
    process.env.APP_ENCRYPTION_KEY = "12345678901234567890123456789012";

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    await prisma.$connect();
    core = await import("@scouting-platform/core");
    channelsRoute = await import("./channels/route");
    channelDetailRoute = await import("./channels/[id]/route");
    channelEnrichRoute = await import("./channels/[id]/enrich/route");
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
  });
});
