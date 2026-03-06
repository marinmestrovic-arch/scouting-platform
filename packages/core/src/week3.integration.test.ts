import { PrismaClient, RunRequestStatus, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type CoreModule = typeof import("./index");

integration("week 3 core integration", () => {
  let prisma: PrismaClient;
  let core: CoreModule;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.APP_ENCRYPTION_KEY = "12345678901234567890123456789012";

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    await prisma.$connect();
    core = await import("./index");
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        run_results,
        run_requests,
        channel_manual_overrides,
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

  it("creates queued run request and enqueues runs.discover job when key exists", async () => {
    const user = await prisma.user.create({
      data: {
        email: "manager@example.com",
        name: "Manager",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
    });

    await core.setUserYoutubeApiKey({
      userId: user.id,
      rawKey: "yt-key-1",
      actorUserId: user.id,
    });

    const created = await core.createRunRequest({
      userId: user.id,
      name: "Gaming Run",
      query: "gaming creators",
    });

    expect(created.status).toBe("queued");

    const runRequest = await prisma.runRequest.findUnique({
      where: {
        id: created.runId,
      },
    });
    expect(runRequest?.status).toBe(RunRequestStatus.QUEUED);

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'runs.discover'
    `;
    expect(jobs[0]?.count ?? 0).toBeGreaterThan(0);
  });

  it("fails run creation when user has no assigned youtube key", async () => {
    const user = await prisma.user.create({
      data: {
        email: "manager@example.com",
        name: "Manager",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
    });

    await expect(
      core.createRunRequest({
        userId: user.id,
        name: "Gaming Run",
        query: "gaming creators",
      }),
    ).rejects.toMatchObject({
      code: "YOUTUBE_KEY_REQUIRED",
      status: 400,
    });

    const runRequestsCount = await prisma.runRequest.count();
    expect(runRequestsCount).toBe(0);
  });

  it("executes discovery and writes minimal run results", async () => {
    const user = await prisma.user.create({
      data: {
        email: "manager@example.com",
        name: "Manager",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
    });

    await core.setUserYoutubeApiKey({
      userId: user.id,
      rawKey: "yt-key-1",
      actorUserId: user.id,
    });

    await prisma.channel.createMany({
      data: [
        {
          youtubeChannelId: "UC-A",
          title: "Channel A",
        },
        {
          youtubeChannelId: "UC-B",
          title: "Channel B",
        },
      ],
    });

    const created = await core.createRunRequest({
      userId: user.id,
      name: "Gaming Run",
      query: "gaming creators",
    });

    await core.executeRunDiscover({
      runRequestId: created.runId,
      requestedByUserId: user.id,
    });

    const runRequest = await prisma.runRequest.findUniqueOrThrow({
      where: {
        id: created.runId,
      },
    });

    expect(runRequest.status).toBe(RunRequestStatus.COMPLETED);
    expect(runRequest.lastError).toBeNull();

    const results = await prisma.runResult.findMany({
      where: {
        runRequestId: created.runId,
      },
      orderBy: {
        rank: "asc",
      },
    });
    expect(results).toHaveLength(2);
    expect(results[0]?.rank).toBe(1);
    expect(results[1]?.rank).toBe(2);
  });

  it("persists failed status and last error when discovery validation fails", async () => {
    const user = await prisma.user.create({
      data: {
        email: "manager@example.com",
        name: "Manager",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
    });

    const runRequest = await prisma.runRequest.create({
      data: {
        requestedByUserId: user.id,
        name: "Gaming Run",
        query: "gaming creators",
      },
    });

    await expect(
      core.executeRunDiscover({
        runRequestId: runRequest.id,
        requestedByUserId: user.id,
      }),
    ).rejects.toMatchObject({
      code: "YOUTUBE_KEY_REQUIRED",
      status: 400,
    });

    const updated = await prisma.runRequest.findUniqueOrThrow({
      where: {
        id: runRequest.id,
      },
    });
    expect(updated.status).toBe(RunRequestStatus.FAILED);
    expect(updated.lastError).toContain("YouTube API key");
  });

  it("is idempotent when duplicate discovery execution happens", async () => {
    const user = await prisma.user.create({
      data: {
        email: "manager@example.com",
        name: "Manager",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
    });

    await core.setUserYoutubeApiKey({
      userId: user.id,
      rawKey: "yt-key-1",
      actorUserId: user.id,
    });

    await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-A",
        title: "Channel A",
      },
    });

    const runRequest = await prisma.runRequest.create({
      data: {
        requestedByUserId: user.id,
        name: "Gaming Run",
        query: "gaming creators",
      },
    });

    await core.executeRunDiscover({
      runRequestId: runRequest.id,
      requestedByUserId: user.id,
    });
    await core.executeRunDiscover({
      runRequestId: runRequest.id,
      requestedByUserId: user.id,
    });

    const resultsCount = await prisma.runResult.count({
      where: {
        runRequestId: runRequest.id,
      },
    });
    expect(resultsCount).toBe(1);
  });
});
