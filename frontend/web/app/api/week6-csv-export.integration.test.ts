import {
  AdvancedReportRequestStatus,
  ChannelEnrichmentStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { createPrismaClient } from "@scouting-platform/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;

let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

integration("week 6 csv export API integration", () => {
  let prisma: PrismaClient;
  let batchesRoute: typeof import("./csv-export-batches/route");
  let batchDetailRoute: typeof import("./csv-export-batches/[id]/route");
  let batchDownloadRoute: typeof import("./csv-export-batches/[id]/download/route");
  let core: typeof import("@scouting-platform/core");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "week6-csv-export-api-auth-secret";

    prisma = createPrismaClient({ databaseUrl });

    await prisma.$connect();
    core = await import("@scouting-platform/core");
    batchesRoute = await import("./csv-export-batches/route");
    batchDetailRoute = await import("./csv-export-batches/[id]/route");
    batchDownloadRoute = await import("./csv-export-batches/[id]/download/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;
    await core.stopCsvExportsQueue();

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
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
      DELETE FROM pgboss.job WHERE name = 'exports.csv.generate'
    `);
  });

  afterEach(async () => {
    await core.stopCsvExportsQueue();
  });

  afterAll(async () => {
    await core.stopCsvExportsQueue();
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

    await prisma.channelContact.create({
      data: {
        channelId: channel.id,
        email: "creator@example.com",
      },
    });

    await prisma.channelMetric.create({
      data: {
        channelId: channel.id,
        subscriberCount: 1200n,
        viewCount: 55000n,
        videoCount: 18n,
      },
    });

    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: ChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: input.requestedByUserId,
        requestedAt: new Date(),
        completedAt: new Date(),
        summary: "Gaming creator",
        topics: ["gaming"],
        brandFitNotes: "Good fit for peripherals",
      },
    });

    await prisma.advancedReportRequest.create({
      data: {
        channelId: channel.id,
        requestedByUserId: input.requestedByUserId,
        status: AdvancedReportRequestStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    return channel;
  }

  it("supports authenticated create, list, detail, and download routes", async () => {
    const manager = await createUser("manager@example.com");
    const channel = await createChannel({
      youtubeChannelId: "UC-WEEK6-API",
      title: "Week 6 API",
      requestedByUserId: manager.id,
    });
    currentSessionUser = { id: manager.id, role: "user" };

    const createResponse = await batchesRoute.POST(
      new Request("http://localhost/api/csv-export-batches", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "selected",
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
    expect(listPayload.items[0]?.id).toBe(createPayload.id);

    const detailResponse = await batchDetailRoute.GET(
      new Request(`http://localhost/api/csv-export-batches/${createPayload.id}`),
      { params: Promise.resolve({ id: createPayload.id }) },
    );
    expect(detailResponse.status).toBe(200);
    const detailPayload = await detailResponse.json();
    expect(detailPayload.scope).toEqual({
      type: "selected",
      channelIds: [channel.id],
    });

    const blockedDownload = await batchDownloadRoute.GET(
      new Request(`http://localhost/api/csv-export-batches/${createPayload.id}/download`),
      { params: Promise.resolve({ id: createPayload.id }) },
    );
    expect(blockedDownload.status).toBe(409);

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'exports.csv.generate'
    `);

    await core.executeCsvExportBatch({
      exportBatchId: createPayload.id,
      requestedByUserId: manager.id,
    });

    const downloadResponse = await batchDownloadRoute.GET(
      new Request(`http://localhost/api/csv-export-batches/${createPayload.id}/download`),
      { params: Promise.resolve({ id: createPayload.id }) },
    );
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toContain("text/csv");
    expect(downloadResponse.headers.get("content-disposition")).toContain(".csv");
    const csvText = await downloadResponse.text();
    expect(csvText).toContain("channelId,youtubeChannelId,youtubeChannelUrl");
    expect(csvText).toContain(channel.id);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const listResponse = await batchesRoute.GET();
    expect(listResponse.status).toBe(401);

    const createResponse = await batchesRoute.POST(
      new Request("http://localhost/api/csv-export-batches", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "filtered",
          filters: {},
        }),
      }),
    );
    expect(createResponse.status).toBe(401);
  });

  it("returns 400 for invalid payloads and invalid export ids", async () => {
    const manager = await createUser("manager@example.com");
    currentSessionUser = { id: manager.id, role: "user" };

    const invalidPayloadResponse = await batchesRoute.POST(
      new Request("http://localhost/api/csv-export-batches", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "selected",
          channelIds: [],
        }),
      }),
    );
    expect(invalidPayloadResponse.status).toBe(400);

    const invalidIdResponse = await batchDetailRoute.GET(
      new Request("http://localhost/api/csv-export-batches/not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(invalidIdResponse.status).toBe(400);
  });

  it("hides non-owner detail and download access as not found", async () => {
    const manager = await createUser("manager@example.com");
    const otherManager = await createUser("other@example.com");
    const channel = await createChannel({
      youtubeChannelId: "UC-WEEK6-OWNER",
      title: "Owner Only",
      requestedByUserId: manager.id,
    });
    currentSessionUser = { id: manager.id, role: "user" };

    const createResponse = await batchesRoute.POST(
      new Request("http://localhost/api/csv-export-batches", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "selected",
          channelIds: [channel.id],
        }),
      }),
    );
    const createPayload = await createResponse.json();

    currentSessionUser = { id: otherManager.id, role: "user" };

    const detailResponse = await batchDetailRoute.GET(
      new Request(`http://localhost/api/csv-export-batches/${createPayload.id}`),
      { params: Promise.resolve({ id: createPayload.id }) },
    );
    expect(detailResponse.status).toBe(404);

    const downloadResponse = await batchDownloadRoute.GET(
      new Request(`http://localhost/api/csv-export-batches/${createPayload.id}/download`),
      { params: Promise.resolve({ id: createPayload.id }) },
    );
    expect(downloadResponse.status).toBe(404);
  });
});
