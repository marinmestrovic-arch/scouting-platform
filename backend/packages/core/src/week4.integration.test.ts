import {
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fetchYoutubeChannelContextMock = vi.fn();
const enrichChannelWithOpenAiMock = vi.fn();

vi.mock("@scouting-platform/integrations", async () => {
  const actual = await vi.importActual<typeof import("@scouting-platform/integrations")>(
    "@scouting-platform/integrations",
  );

  return {
    ...actual,
    fetchYoutubeChannelContext: fetchYoutubeChannelContextMock,
    enrichChannelWithOpenAi: enrichChannelWithOpenAiMock,
  };
});

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type CoreModule = typeof import("./index");

const CACHED_CONTEXT = {
  youtubeChannelId: "UC-ENRICH-1",
  title: "Channel Name",
  handle: "@channel-name",
  description: "Channel description",
  thumbnailUrl: "https://img.example.com/channel.jpg",
  publishedAt: "2021-01-01T00:00:00Z",
  subscriberCount: 1200,
  viewCount: 45000,
  videoCount: 87,
  recentVideos: [
    {
      youtubeVideoId: "video-1",
      title: "Latest video",
      description: "Video description",
      publishedAt: "2024-01-10T12:00:00Z",
      viewCount: 100,
      likeCount: 10,
      commentCount: 5,
    },
    {
      youtubeVideoId: "video-2",
      title: "Second video",
      description: null,
      publishedAt: "2024-01-09T12:00:00Z",
      viewCount: 200,
      likeCount: 20,
      commentCount: 10,
    },
  ],
  diagnostics: {
    warnings: [],
  },
} as const;

const ENRICHMENT_RESULT = {
  profile: {
    summary: "Creator focused on gaming commentary.",
    topics: ["gaming", "commentary"],
    brandFitNotes: "Strong fit for gaming peripherals.",
    confidence: 0.82,
  },
  rawPayload: {
    id: "resp-1",
  },
} as const;

const STORED_OPENAI_RAW_PAYLOAD = {
  id: "resp-stored",
  choices: [
    {
      message: {
        content: JSON.stringify(ENRICHMENT_RESULT.profile),
      },
    },
  ],
} as const;

integration("week 4 core integration", () => {
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
    process.env.OPENAI_API_KEY = "test-openai-key";

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
    process.env.OPENAI_API_KEY = "test-openai-key";
    fetchYoutubeChannelContextMock.mockReset();
    enrichChannelWithOpenAiMock.mockReset();
    vi.resetModules();

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

  async function createUser(email = "manager@example.com"): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email,
        name: "Manager",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  async function createChannel(
    youtubeChannelId = "UC-ENRICH-1",
    title = "Channel Name",
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

  async function assignYoutubeKey(userId: string): Promise<void> {
    await getCore().setUserYoutubeApiKey({
      userId,
      rawKey: "yt-key-1",
      actorUserId: userId,
    });
  }

  it("creates queued enrichment, records audit, and enqueues channels.enrich.llm", async () => {
    const user = await createUser();
    const channel = await createChannel();
    await assignYoutubeKey(user.id);

    const created = await getCore().requestChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    expect(created.enrichment.status).toBe("queued");

    const enrichment = await prisma.channelEnrichment.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(enrichment.status).toBe(PrismaChannelEnrichmentStatus.QUEUED);
    expect(enrichment.requestedByUserId).toBe(user.id);

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        action: "channel.enrichment.requested",
        entityId: channel.id,
      },
    });
    expect(auditEvent).not.toBeNull();

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'channels.enrich.llm'
    `;
    expect(jobs[0]?.count).toBe(1);
  });

  it("does not enqueue duplicate work while enrichment is queued or running", async () => {
    const user = await createUser();
    const channel = await createChannel();
    await assignYoutubeKey(user.id);

    await getCore().requestChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    const queuedAgain = await getCore().requestChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    expect(queuedAgain.enrichment.status).toBe("queued");

    let jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'channels.enrich.llm'
    `;
    expect(jobs[0]?.count).toBe(1);

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'channels.enrich.llm'
    `);
    await prisma.channelEnrichment.update({
      where: {
        channelId: channel.id,
      },
      data: {
        status: PrismaChannelEnrichmentStatus.RUNNING,
      },
    });

    const runningAgain = await getCore().requestChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    expect(runningAgain.enrichment.status).toBe("running");

    jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'channels.enrich.llm'
    `;
    expect(jobs[0]?.count).toBe(0);
  });

  it("reuses fresh cached youtube context during execution", async () => {
    const user = await createUser();
    const channel = await createChannel();
    await assignYoutubeKey(user.id);

    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: PrismaChannelEnrichmentStatus.QUEUED,
        requestedByUserId: user.id,
        requestedAt: new Date(),
      },
    });
    await prisma.channelYoutubeContext.create({
      data: {
        channelId: channel.id,
        context: CACHED_CONTEXT,
        fetchedAt: new Date(),
      },
    });

    enrichChannelWithOpenAiMock.mockResolvedValue(ENRICHMENT_RESULT);

    await getCore().executeChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    expect(fetchYoutubeChannelContextMock).not.toHaveBeenCalled();
    expect(enrichChannelWithOpenAiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        youtubeContext: CACHED_CONTEXT,
      }),
    );
  });

  it("refreshes missing or stale youtube context and persists completed enrichment data", async () => {
    const user = await createUser();
    const channel = await createChannel();
    await assignYoutubeKey(user.id);

    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: PrismaChannelEnrichmentStatus.QUEUED,
        requestedByUserId: user.id,
        requestedAt: new Date(),
      },
    });

    fetchYoutubeChannelContextMock.mockResolvedValue(CACHED_CONTEXT);
    enrichChannelWithOpenAiMock.mockResolvedValue(ENRICHMENT_RESULT);

    await getCore().executeChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    expect(fetchYoutubeChannelContextMock).toHaveBeenCalledTimes(1);

    const contextRow = await prisma.channelYoutubeContext.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(contextRow.lastError).toBeNull();
    expect(contextRow.context).toMatchObject(CACHED_CONTEXT);

    const persistedChannel = await prisma.channel.findUniqueOrThrow({
      where: {
        id: channel.id,
      },
      select: {
        handle: true,
        youtubeUrl: true,
      },
    });
    expect(persistedChannel.handle).toBe("@channel-name");
    expect(persistedChannel.youtubeUrl).toBe("https://www.youtube.com/@channel-name");

    const metrics = await prisma.channelMetric.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(metrics.youtubeAverageViews).toBe(517n);
    expect(metrics.youtubeFollowers).toBe(1200n);
    expect(metrics.youtubeEngagementRate).toBeCloseTo(15, 5);

    const enrichment = await prisma.channelEnrichment.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(enrichment.status).toBe(PrismaChannelEnrichmentStatus.COMPLETED);
    expect(enrichment.summary).toBe(ENRICHMENT_RESULT.profile.summary);
    expect(enrichment.topics).toEqual(ENRICHMENT_RESULT.profile.topics);
    expect(enrichment.brandFitNotes).toBe(ENRICHMENT_RESULT.profile.brandFitNotes);
    expect(enrichment.confidence).toBe(ENRICHMENT_RESULT.profile.confidence);
    expect(enrichment.lastError).toBeNull();
    expect(enrichment.rawOpenaiPayload).toMatchObject(ENRICHMENT_RESULT.rawPayload);

    await prisma.channelEnrichment.update({
      where: {
        channelId: channel.id,
      },
      data: {
        status: PrismaChannelEnrichmentStatus.FAILED,
      },
    });
    await prisma.channelYoutubeContext.update({
      where: {
        channelId: channel.id,
      },
      data: {
        fetchedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      },
    });

    fetchYoutubeChannelContextMock.mockResolvedValueOnce({
      ...CACHED_CONTEXT,
      title: "Channel Name Refreshed",
    });
    enrichChannelWithOpenAiMock.mockResolvedValueOnce(ENRICHMENT_RESULT);

    await getCore().executeChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    expect(fetchYoutubeChannelContextMock).toHaveBeenCalledTimes(2);

    const refreshedContext = await prisma.channelYoutubeContext.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(refreshedContext.context).toMatchObject({
      title: "Channel Name Refreshed",
    });
  });

  it("keeps enrichment successful when recent video stats are incomplete and persists diagnostics", async () => {
    const user = await createUser();
    const channel = await createChannel("UC-ENRICH-BEST-EFFORT", "Best Effort Channel");
    await assignYoutubeKey(user.id);

    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: PrismaChannelEnrichmentStatus.QUEUED,
        requestedByUserId: user.id,
        requestedAt: new Date(),
      },
    });

    fetchYoutubeChannelContextMock.mockResolvedValue({
      ...CACHED_CONTEXT,
      youtubeChannelId: "UC-ENRICH-BEST-EFFORT",
      handle: "channel-best-effort",
      recentVideos: [
        {
          youtubeVideoId: "video-1",
          title: "Latest video",
          description: null,
          publishedAt: "2024-01-10T12:00:00Z",
          viewCount: null,
          likeCount: null,
          commentCount: null,
        },
      ],
      diagnostics: {
        warnings: ["Recent video statistics unavailable: YouTube API quota exceeded"],
      },
    });
    enrichChannelWithOpenAiMock.mockResolvedValue(ENRICHMENT_RESULT);

    await getCore().executeChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    const enrichment = await prisma.channelEnrichment.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(enrichment.status).toBe(PrismaChannelEnrichmentStatus.COMPLETED);
    expect(enrichment.lastError).toBeNull();

    const persistedChannel = await prisma.channel.findUniqueOrThrow({
      where: {
        id: channel.id,
      },
      select: {
        handle: true,
        youtubeUrl: true,
      },
    });
    expect(persistedChannel.handle).toBe("@channel-best-effort");
    expect(persistedChannel.youtubeUrl).toBe("https://www.youtube.com/@channel-best-effort");

    const metrics = await prisma.channelMetric.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(metrics.youtubeAverageViews).toBe(517n);
    expect(metrics.youtubeFollowers).toBe(1200n);
    expect(metrics.youtubeEngagementRate).toBeNull();

    const contextRow = await prisma.channelYoutubeContext.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(contextRow.lastError).toBeNull();
    expect(contextRow.context).toMatchObject({
      handle: "@channel-best-effort",
      diagnostics: {
        warnings: [
          "Recent video statistics unavailable: YouTube API quota exceeded",
          "No recent uploads contained complete statistics for engagement-rate derivation.",
        ],
      },
    });
  });

  it("persists failed status and last error when execution fails", async () => {
    const user = await createUser();
    const channel = await createChannel();
    await assignYoutubeKey(user.id);

    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: PrismaChannelEnrichmentStatus.QUEUED,
        requestedByUserId: user.id,
        requestedAt: new Date(),
      },
    });

    fetchYoutubeChannelContextMock.mockResolvedValue(CACHED_CONTEXT);
    enrichChannelWithOpenAiMock.mockRejectedValue(
      new (await import("@scouting-platform/integrations")).OpenAiChannelEnrichmentError(
        "OPENAI_RATE_LIMITED",
        429,
        "OpenAI rate limit exceeded",
      ),
    );

    await expect(
      getCore().executeChannelLlmEnrichment({
        channelId: channel.id,
        requestedByUserId: user.id,
      }),
    ).rejects.toMatchObject({
      code: "OPENAI_RATE_LIMITED",
      status: 429,
    });

    const enrichment = await prisma.channelEnrichment.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(enrichment.status).toBe(PrismaChannelEnrichmentStatus.FAILED);
    expect(enrichment.lastError).toContain("OpenAI rate limit exceeded");
  });

  it("skips OpenAI when rawOpenaiPayloadFetchedAt is set", async () => {
    const user = await createUser();
    const channel = await createChannel("UC-ENRICH-REUSE", "Reuse Channel");
    await assignYoutubeKey(user.id);

    await prisma.channelYoutubeContext.create({
      data: {
        channelId: channel.id,
        context: CACHED_CONTEXT,
        fetchedAt: new Date(),
      },
    });
    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: PrismaChannelEnrichmentStatus.FAILED,
        requestedByUserId: user.id,
        requestedAt: new Date(),
        rawOpenaiPayload: STORED_OPENAI_RAW_PAYLOAD,
        rawOpenaiPayloadFetchedAt: new Date(),
      },
    });

    await getCore().executeChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    expect(enrichChannelWithOpenAiMock).not.toHaveBeenCalled();

    const enrichment = await prisma.channelEnrichment.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(enrichment.status).toBe(PrismaChannelEnrichmentStatus.COMPLETED);
    expect(enrichment.summary).toBe(ENRICHMENT_RESULT.profile.summary);
    expect(enrichment.brandFitNotes).toBe(ENRICHMENT_RESULT.profile.brandFitNotes);
    expect(enrichment.confidence).toBe(ENRICHMENT_RESULT.profile.confidence);
  });

  it("skips YouTube fetch when youtubeFetchedAt is set", async () => {
    const user = await createUser();
    const channel = await createChannel("UC-ENRICH-YT-REUSE", "YouTube Reuse");
    await assignYoutubeKey(user.id);

    await prisma.channelYoutubeContext.create({
      data: {
        channelId: channel.id,
        context: CACHED_CONTEXT,
        fetchedAt: new Date(),
      },
    });
    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: PrismaChannelEnrichmentStatus.FAILED,
        requestedByUserId: user.id,
        requestedAt: new Date(),
        youtubeFetchedAt: new Date(),
      },
    });

    enrichChannelWithOpenAiMock.mockResolvedValue(ENRICHMENT_RESULT);

    await getCore().executeChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    expect(fetchYoutubeChannelContextMock).not.toHaveBeenCalled();
  });

  it("resets attempt markers to null on successful completion", async () => {
    const user = await createUser();
    const channel = await createChannel("UC-ENRICH-RESET", "Reset Markers");
    await assignYoutubeKey(user.id);

    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: PrismaChannelEnrichmentStatus.QUEUED,
        requestedByUserId: user.id,
        requestedAt: new Date(),
      },
    });

    fetchYoutubeChannelContextMock.mockResolvedValue(CACHED_CONTEXT);
    enrichChannelWithOpenAiMock.mockResolvedValue(ENRICHMENT_RESULT);

    await getCore().executeChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    const enrichment = await prisma.channelEnrichment.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(enrichment.youtubeFetchedAt).toBeNull();
    expect(enrichment.rawOpenaiPayloadFetchedAt).toBeNull();
  });

  it("sets rawOpenaiPayloadFetchedAt even when the final transaction fails", async () => {
    const user = await createUser();
    const channel = await createChannel("UC-ENRICH-TX-FAIL", "Transaction Failure");
    await assignYoutubeKey(user.id);

    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: PrismaChannelEnrichmentStatus.QUEUED,
        requestedByUserId: user.id,
        requestedAt: new Date(),
      },
    });

    fetchYoutubeChannelContextMock.mockResolvedValue(CACHED_CONTEXT);
    enrichChannelWithOpenAiMock.mockResolvedValue(ENRICHMENT_RESULT);

    const db = await import("@scouting-platform/db");
    const originalTransaction = db.prisma.$transaction.bind(db.prisma);
    const transactionSpy = vi.spyOn(db.prisma, "$transaction");
    transactionSpy.mockImplementation((async (arg: unknown, ...rest: unknown[]) => {
      if (typeof arg === "function") {
        return originalTransaction(async (tx) => {
          await (arg as (client: unknown) => Promise<unknown>)(tx);
          throw new Error("final transaction boom");
        }, ...(rest as []));
      }

      return originalTransaction(arg as never, ...(rest as []));
    }) as typeof db.prisma.$transaction);

    try {
      await expect(
        getCore().executeChannelLlmEnrichment({
          channelId: channel.id,
          requestedByUserId: user.id,
        }),
      ).rejects.toThrow("final transaction boom");
    } finally {
      transactionSpy.mockRestore();
    }

    const enrichment = await prisma.channelEnrichment.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(enrichment.rawOpenaiPayloadFetchedAt).not.toBeNull();
    expect(enrichment.status).toBe(PrismaChannelEnrichmentStatus.FAILED);
  });

  it("returns stale enrichment when completion age or channel freshness rules are violated", async () => {
    const user = await createUser();
    const channelByAge = await createChannel("UC-STALE-AGE", "Old Completion");
    const channelByUpdate = await createChannel("UC-STALE-UPDATE", "Updated Channel");

    await prisma.channelEnrichment.create({
      data: {
        channelId: channelByAge.id,
        status: PrismaChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: user.id,
        requestedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        summary: "Old summary",
        topics: ["gaming"],
        brandFitNotes: "Old notes",
        confidence: 0.5,
      },
    });
    await prisma.channelEnrichment.create({
      data: {
        channelId: channelByUpdate.id,
        status: PrismaChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: user.id,
        requestedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        summary: "Fresh-ish summary",
        topics: ["tech"],
        brandFitNotes: "Fresh-ish notes",
        confidence: 0.7,
      },
    });

    const staleByAge = await getCore().getChannelById(channelByAge.id);
    const staleByUpdate = await getCore().getChannelById(channelByUpdate.id);

    expect(staleByAge?.enrichment.status).toBe("stale");
    expect(staleByUpdate?.enrichment.status).toBe("stale");
  });
});
