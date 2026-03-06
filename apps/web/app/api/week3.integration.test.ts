import { CredentialProvider, PrismaClient, Role, RunRequestStatus, RunResultSource } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;
type CoreModule = typeof import("@scouting-platform/core");

let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

integration("week 3 API integration", () => {
  let prisma: PrismaClient;
  let core: CoreModule;
  let runsRoute: typeof import("./runs/route");
  let runDetailRoute: typeof import("./runs/[id]/route");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "week3-integration-auth-secret";
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
    runsRoute = await import("./runs/route");
    runDetailRoute = await import("./runs/[id]/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        run_results,
        run_requests,
        saved_segments,
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
      DELETE FROM pgboss.job WHERE name = 'runs.discover'
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

  it("returns 401 for unauthenticated run routes", async () => {
    const createResponse = await runsRoute.POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Run", query: "gaming creators" }),
      }),
    );
    expect(createResponse.status).toBe(401);

    const detailResponse = await runDetailRoute.GET(
      new Request("http://localhost/api/runs/6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b"),
      { params: Promise.resolve({ id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b" }) },
    );
    expect(detailResponse.status).toBe(401);
  });

  it("returns 400 for invalid run creation payload", async () => {
    const user = await createUser("manager@example.com");
    currentSessionUser = { id: user.id, role: "user" };

    const response = await runsRoute.POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "", query: "" }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("creates run with 202 when youtube key is assigned", async () => {
    const user = await createUser("manager@example.com");
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

    const response = await runsRoute.POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Run 1", query: "gaming creators" }),
      }),
    );

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload.status).toBe("queued");

    const run = await prisma.runRequest.findUnique({
      where: {
        id: payload.runId as string,
      },
    });
    expect(run).not.toBeNull();
  });

  it("returns 404 for missing run and 403 for non-owner access", async () => {
    const owner = await createUser("owner@example.com");
    const otherUser = await createUser("other@example.com");
    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: owner.id,
        name: "Owner Run",
        query: "query",
        status: RunRequestStatus.QUEUED,
      },
      select: {
        id: true,
      },
    });

    currentSessionUser = { id: otherUser.id, role: "user" };
    const forbidden = await runDetailRoute.GET(
      new Request(`http://localhost/api/runs/${run.id}`),
      { params: Promise.resolve({ id: run.id }) },
    );
    expect(forbidden.status).toBe(403);

    currentSessionUser = { id: owner.id, role: "user" };
    const missing = await runDetailRoute.GET(
      new Request("http://localhost/api/runs/6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b"),
      { params: Promise.resolve({ id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b" }) },
    );
    expect(missing.status).toBe(404);
  });

  it("returns run status and minimal results for owner/admin", async () => {
    const owner = await createUser("owner@example.com");
    const admin = await createUser("admin@example.com", Role.ADMIN);
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-RUN-1",
        title: "Channel 1",
      },
    });
    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: owner.id,
        name: "Owner Run",
        query: "query",
        status: RunRequestStatus.COMPLETED,
      },
    });
    await prisma.runResult.create({
      data: {
        runRequestId: run.id,
        channelId: channel.id,
        rank: 1,
        source: RunResultSource.CATALOG,
      },
    });

    currentSessionUser = { id: owner.id, role: "user" };
    const ownerResponse = await runDetailRoute.GET(
      new Request(`http://localhost/api/runs/${run.id}`),
      { params: Promise.resolve({ id: run.id }) },
    );
    expect(ownerResponse.status).toBe(200);
    const ownerPayload = await ownerResponse.json();
    expect(ownerPayload.results).toHaveLength(1);
    expect(ownerPayload.results[0]?.source).toBe("catalog");

    currentSessionUser = { id: admin.id, role: "admin" };
    const adminResponse = await runDetailRoute.GET(
      new Request(`http://localhost/api/runs/${run.id}`),
      { params: Promise.resolve({ id: run.id }) },
    );
    expect(adminResponse.status).toBe(200);
  });
});
