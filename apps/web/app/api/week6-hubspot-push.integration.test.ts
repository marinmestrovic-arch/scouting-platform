import { PrismaClient, Role } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;

let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

integration("week 6 hubspot push API integration", () => {
  let prisma: PrismaClient;
  let batchesRoute: typeof import("./hubspot-push-batches/route");
  let batchDetailRoute: typeof import("./hubspot-push-batches/[id]/route");
  let core: typeof import("@scouting-platform/core");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "week6-hubspot-push-api-auth-secret";
    process.env.HUBSPOT_API_KEY = "hubspot-key";

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    await prisma.$connect();
    core = await import("@scouting-platform/core");
    batchesRoute = await import("./hubspot-push-batches/route");
    batchDetailRoute = await import("./hubspot-push-batches/[id]/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;
    await core.stopHubspotPushQueue();

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        hubspot_push_batch_rows,
        hubspot_push_batches,
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
      DELETE FROM pgboss.job WHERE name = 'hubspot.push.batch'
    `);
  });

  afterEach(async () => {
    await core.stopHubspotPushQueue();
  });

  afterAll(async () => {
    await core.stopHubspotPushQueue();
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

  async function createChannel(input: {
    youtubeChannelId: string;
    title: string;
    email?: string;
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

    if (input.email) {
      await prisma.channelContact.create({
        data: {
          channelId: channel.id,
          email: input.email,
        },
      });
    }

    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: "COMPLETED",
        requestedByUserId: input.requestedByUserId,
        requestedAt: new Date(),
        completedAt: new Date(),
        summary: "Creator summary",
        topics: ["gaming"],
        brandFitNotes: "Great fit",
      },
    });

    return channel;
  }

  it("supports authenticated create, list, and detail routes", async () => {
    const manager = await createUser("manager@example.com");
    const channel = await createChannel({
      youtubeChannelId: "UC-WEEK6-HUB",
      title: "Week 6 HubSpot",
      email: "creator@example.com",
      requestedByUserId: manager.id,
    });
    currentSessionUser = { id: manager.id, role: "user" };

    const createResponse = await batchesRoute.POST(
      new Request("http://localhost/api/hubspot-push-batches", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channelIds: [channel.id],
        }),
      }),
    );
    expect(createResponse.status).toBe(202);
    const createPayload = await createResponse.json();
    expect(createPayload.status).toBe("queued");

    const listResponse = await batchesRoute.GET();
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.items).toHaveLength(1);

    await prisma.hubspotPushBatchRow.updateMany({
      where: {
        batchId: createPayload.id,
      },
      data: {
        contactEmail: "creator@example.com",
        status: "PUSHED",
        hubspotObjectId: "hubspot-contact-1",
      },
    });
    await prisma.hubspotPushBatch.update({
      where: {
        id: createPayload.id,
      },
      data: {
        status: "COMPLETED",
        pushedRowCount: 1,
        completedAt: new Date(),
      },
    });

    const detailResponse = await batchDetailRoute.GET(
      new Request(`http://localhost/api/hubspot-push-batches/${createPayload.id}`),
      { params: Promise.resolve({ id: createPayload.id }) },
    );
    expect(detailResponse.status).toBe(200);
    const detailPayload = await detailResponse.json();
    expect(detailPayload.scope).toEqual({
      channelIds: [channel.id],
    });
    expect(detailPayload.rows[0]?.status).toBe("pushed");
  });

  it("returns normalized validation and auth errors", async () => {
    const unauthenticatedResponse = await batchesRoute.GET();
    expect(unauthenticatedResponse.status).toBe(401);

    const manager = await createUser("manager@example.com");
    currentSessionUser = { id: manager.id, role: "user" };

    const invalidCreateResponse = await batchesRoute.POST(
      new Request("http://localhost/api/hubspot-push-batches", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channelIds: [],
        }),
      }),
    );
    expect(invalidCreateResponse.status).toBe(400);

    const invalidDetailResponse = await batchDetailRoute.GET(
      new Request("http://localhost/api/hubspot-push-batches/not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(invalidDetailResponse.status).toBe(400);
  });
});
