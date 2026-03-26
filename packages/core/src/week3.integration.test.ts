import { PrismaClient, Role, RunRequestStatus, RunResultSource } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type CoreModule = typeof import("./index");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

integration("week 3 core integration", () => {
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
    process.env.APP_ENCRYPTION_KEY = "12345678901234567890123456789012";

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.APP_ENCRYPTION_KEY = "12345678901234567890123456789012";
    vi.restoreAllMocks();
    vi.resetModules();

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

    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    core = await import("./index");
  });

  afterEach(async () => {
    await core?.stopRunsQueue();
    core = null;
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterAll(async () => {
    await core?.stopRunsQueue();
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    await prisma.$disconnect();
  });

  async function buildRunMetadata(campaignManagerUserId: string) {
    const client = await prisma.client.create({
      data: {
        name: `Client ${campaignManagerUserId.slice(0, 8)} ${Math.random()}`,
      },
    });
    const market = await prisma.market.create({
      data: {
        name: `Market ${campaignManagerUserId.slice(0, 8)} ${Math.random()}`,
      },
    });
    const campaign = await prisma.campaign.create({
      data: {
        name: `Spring Launch ${campaignManagerUserId.slice(0, 8)} ${Math.random()}`,
        clientId: client.id,
        marketId: market.id,
        month: "MARCH",
        year: 2026,
        isActive: true,
      },
    });

    return {
      campaignId: campaign.id,
    };
  }

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

    await getCore().setUserYoutubeApiKey({
      userId: user.id,
      rawKey: "yt-key-1",
      actorUserId: user.id,
    });

    const created = await getCore().createRunRequest({
      userId: user.id,
      name: "Gaming Run",
      query: "gaming creators",
      target: 20,
      metadata: await buildRunMetadata(user.id),
    });

    expect(created.status).toBe("queued");

    const runRequest = await prisma.runRequest.findUnique({
      where: {
        id: created.runId,
      },
    });
    expect(runRequest?.status).toBe(RunRequestStatus.QUEUED);
    expect(runRequest?.target).toBe(20);

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
      getCore().createRunRequest({
        userId: user.id,
        name: "Gaming Run",
        query: "gaming creators",
        target: 20,
        metadata: await buildRunMetadata(user.id),
      }),
    ).rejects.toMatchObject({
      code: "YOUTUBE_KEY_REQUIRED",
      status: 400,
    });

    const runRequestsCount = await prisma.runRequest.count();
    expect(runRequestsCount).toBe(0);
  });

  it("lists the latest 10 runs for the current user with lifecycle fields and result counts", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner@example.com",
        name: "Owner",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
    });
    const otherUser = await prisma.user.create({
      data: {
        email: "other@example.com",
        name: "Other",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
    });
    const channels = await prisma.$transaction([
      prisma.channel.create({
        data: {
          youtubeChannelId: "UC-RUN-LIST-1",
          title: "Run List Channel 1",
        },
      }),
      prisma.channel.create({
        data: {
          youtubeChannelId: "UC-RUN-LIST-2",
          title: "Run List Channel 2",
        },
      }),
      prisma.channel.create({
        data: {
          youtubeChannelId: "UC-RUN-LIST-3",
          title: "Run List Channel 3",
        },
      }),
    ]);

    for (let index = 1; index <= 12; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 2, index, 9, index, 0));
      const status =
        index === 12
          ? RunRequestStatus.RUNNING
          : index === 11
            ? RunRequestStatus.FAILED
            : RunRequestStatus.COMPLETED;
      const run = await prisma.runRequest.create({
        data: {
          requestedByUserId: owner.id,
          name: `Owner Run ${index}`,
          query: `query ${index}`,
          target: index + 10,
          status,
          lastError: index === 11 ? "YouTube API quota exceeded" : null,
          createdAt,
          updatedAt: createdAt,
          startedAt: createdAt,
          completedAt: status === RunRequestStatus.COMPLETED || status === RunRequestStatus.FAILED ? createdAt : null,
        },
      });

      if (index === 12) {
        await prisma.runResult.createMany({
          data: [
            {
              runRequestId: run.id,
              channelId: channels[0].id,
              rank: 1,
              source: RunResultSource.CATALOG,
            },
            {
              runRequestId: run.id,
              channelId: channels[1].id,
              rank: 2,
              source: RunResultSource.DISCOVERY,
            },
          ],
        });
      }

      if (index === 10) {
        await prisma.runResult.create({
          data: {
            runRequestId: run.id,
            channelId: channels[2].id,
            rank: 1,
            source: RunResultSource.CATALOG,
          },
        });
      }
    }

    await prisma.runRequest.create({
      data: {
        requestedByUserId: otherUser.id,
        name: "Other User Run",
        query: "other query",
        status: RunRequestStatus.COMPLETED,
      },
    });

    const recentRuns = await getCore().listRecentRuns({
      userId: owner.id,
      role: "user",
      limit: 10,
    });

    expect(recentRuns.items).toHaveLength(10);
    expect(recentRuns.items[0]?.name).toBe("Owner Run 12");
    expect(recentRuns.items[0]?.target).toBe(22);
    expect(recentRuns.items[0]?.status).toBe("running");
    expect(recentRuns.items[0]?.resultCount).toBe(2);
    expect(recentRuns.items[1]?.name).toBe("Owner Run 11");
    expect(recentRuns.items[1]?.lastError).toBe("YouTube API quota exceeded");
    expect(recentRuns.items[9]?.name).toBe("Owner Run 3");
    expect(recentRuns.items.some((run) => run.name === "Owner Run 2")).toBe(false);
    expect(recentRuns.items.some((run) => run.name === "Other User Run")).toBe(false);
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

    await getCore().setUserYoutubeApiKey({
      userId: user.id,
      rawKey: "yt-key-1",
      actorUserId: user.id,
    });

    await prisma.channel.createMany({
      data: [
        {
          youtubeChannelId: "UC-CATALOG-1",
          title: "Gaming Channel A",
        },
        {
          youtubeChannelId: "UC-CATALOG-2",
          title: "Gaming Channel B",
        },
        {
          youtubeChannelId: "UC-NON-MATCH",
          title: "Cooking Channel",
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({
            items: [
              { id: { channelId: "UC-CATALOG-2" } },
              { id: { channelId: "UC-DISCOVER-1" } },
              { id: { channelId: "UC-DISCOVER-2" } },
            ],
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            items: [
              {
                id: "UC-CATALOG-2",
                snippet: {
                  title: "Gaming Channel B",
                  description: "Catalog overlap",
                  customUrl: "gaming-b",
                  thumbnails: {
                    default: { url: "https://img.example.com/b.jpg" },
                  },
                },
              },
              {
                id: "UC-DISCOVER-1",
                snippet: {
                  title: "Gaming Discover One",
                  description: "Discovery one",
                  customUrl: "gaming-one",
                  thumbnails: {
                    default: { url: "https://img.example.com/d1.jpg" },
                  },
                },
              },
              {
                id: "UC-DISCOVER-2",
                snippet: {
                  title: "Gaming Discover Two",
                  description: "Discovery two",
                  customUrl: "gaming-two",
                  thumbnails: {
                    default: { url: "https://img.example.com/d2.jpg" },
                  },
                },
              },
            ],
          }),
        ),
    );

    const created = await getCore().createRunRequest({
      userId: user.id,
      name: "Gaming Run",
      query: "gaming",
      target: 25,
      metadata: await buildRunMetadata(user.id),
    });

    await getCore().executeRunDiscover({
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
    expect(results).toHaveLength(4);
    expect(results[0]?.rank).toBe(1);
    expect(results[0]?.source).toBe(RunResultSource.CATALOG);
    expect(results[1]?.source).toBe(RunResultSource.CATALOG);
    expect(results[2]?.source).toBe(RunResultSource.DISCOVERY);
    expect(results[3]?.source).toBe(RunResultSource.DISCOVERY);

    const catalogOverlapChannel = await prisma.channel.findUniqueOrThrow({
      where: {
        youtubeChannelId: "UC-CATALOG-2",
      },
      select: {
        id: true,
      },
    });
    const dedupedCatalogOverlap = results.filter(
      (result) => result.channelId === catalogOverlapChannel.id,
    );
    expect(dedupedCatalogOverlap).toHaveLength(1);
    expect(dedupedCatalogOverlap[0]?.source).toBe(RunResultSource.CATALOG);

    const discoveredChannels = await prisma.channel.findMany({
      where: {
        youtubeChannelId: {
          in: ["UC-DISCOVER-1", "UC-DISCOVER-2"],
        },
      },
      orderBy: {
        youtubeChannelId: "asc",
      },
    });
    expect(discoveredChannels).toHaveLength(2);
  });

  it("marks previously cataloged discovered channels as catalog even when query presearch misses them", async () => {
    const user = await prisma.user.create({
      data: {
        email: "manager@example.com",
        name: "Manager",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
    });

    await getCore().setUserYoutubeApiKey({
      userId: user.id,
      rawKey: "yt-key-1",
      actorUserId: user.id,
    });

    const existingChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-KNOWN-1",
        title: "Already Known Creator",
      },
    });

    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({
            items: [
              { id: { channelId: "UC-KNOWN-1" } },
              { id: { channelId: "UC-NEW-1" } },
            ],
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            items: [
              {
                id: "UC-KNOWN-1",
                snippet: {
                  title: "Already Known Creator",
                  description: "Previously cataloged via an earlier run",
                  customUrl: "already-known",
                  thumbnails: {
                    default: { url: "https://img.example.com/known.jpg" },
                  },
                },
              },
              {
                id: "UC-NEW-1",
                snippet: {
                  title: "Fresh Discovery Creator",
                  description: "Brand new result",
                  customUrl: "fresh-discovery",
                  thumbnails: {
                    default: { url: "https://img.example.com/new.jpg" },
                  },
                },
              },
            ],
          }),
        ),
    );

    const created = await getCore().createRunRequest({
      userId: user.id,
      name: "Second Run",
      query: "gaming",
      target: 12,
      metadata: await buildRunMetadata(user.id),
    });

    await getCore().executeRunDiscover({
      runRequestId: created.runId,
      requestedByUserId: user.id,
    });

    const results = await prisma.runResult.findMany({
      where: {
        runRequestId: created.runId,
      },
      orderBy: {
        rank: "asc",
      },
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      channelId: existingChannel.id,
      source: RunResultSource.CATALOG,
    });
    expect(results[1]?.source).toBe(RunResultSource.DISCOVERY);

    const knownChannelRows = await prisma.channel.findMany({
      where: {
        youtubeChannelId: "UC-KNOWN-1",
      },
      select: {
        id: true,
      },
    });
    expect(knownChannelRows).toEqual([{ id: existingChannel.id }]);
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
      getCore().executeRunDiscover({
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

  it("persists failed status and last error when youtube quota is exceeded", async () => {
    const user = await prisma.user.create({
      data: {
        email: "manager@example.com",
        name: "Manager",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
    });

    await getCore().setUserYoutubeApiKey({
      userId: user.id,
      rawKey: "yt-key-1",
      actorUserId: user.id,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              errors: [{ reason: "quotaExceeded" }],
            },
          },
          403,
        ),
      ),
    );

    const runRequest = await prisma.runRequest.create({
      data: {
        requestedByUserId: user.id,
        name: "Gaming Run",
        query: "gaming",
      },
    });

    await expect(
      getCore().executeRunDiscover({
        runRequestId: runRequest.id,
        requestedByUserId: user.id,
      }),
    ).rejects.toMatchObject({
      code: "YOUTUBE_QUOTA_EXCEEDED",
      status: 429,
    });

    const updated = await prisma.runRequest.findUniqueOrThrow({
      where: {
        id: runRequest.id,
      },
    });
    expect(updated.status).toBe(RunRequestStatus.FAILED);
    expect(updated.lastError).toBe("YouTube API quota exceeded");
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

    await getCore().setUserYoutubeApiKey({
      userId: user.id,
      rawKey: "yt-key-1",
      actorUserId: user.id,
    });

    await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-A",
        title: "Gaming Channel A",
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: { channelId: "UC-A" } }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UC-A",
              snippet: {
                title: "Gaming Channel A",
                thumbnails: {},
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const runRequest = await prisma.runRequest.create({
      data: {
        requestedByUserId: user.id,
        name: "Gaming Run",
        query: "gaming",
      },
    });

    await getCore().executeRunDiscover({
      runRequestId: runRequest.id,
      requestedByUserId: user.id,
    });
    await getCore().executeRunDiscover({
      runRequestId: runRequest.id,
      requestedByUserId: user.id,
    });

    const resultsCount = await prisma.runResult.count({
      where: {
        runRequestId: runRequest.id,
      },
    });
    expect(resultsCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
