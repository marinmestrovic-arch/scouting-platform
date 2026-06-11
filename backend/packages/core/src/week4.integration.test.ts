import {
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
  ChannelYoutubeRefreshStatus as PrismaChannelYoutubeRefreshStatus,
  CsvImportBatchStatus as PrismaCsvImportBatchStatus,
  CsvImportRowStatus as PrismaCsvImportRowStatus,
  HubspotPreviewEnrichmentJobStatus as PrismaHubspotPreviewEnrichmentJobStatus,
  PrismaClient,
  Role,
  RunRequestStatus,
  RunResultSource,
} from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fetchYoutubeChannelContextMock = vi.fn();
const fetchYoutubeChannelPageEmailSignalMock = vi.fn();
const enrichChannelWithOpenAiMock = vi.fn();
const enrichCreatorProfilesWithOpenAiMock = vi.fn();

vi.mock("@scouting-platform/integrations", async () => {
  const actual = await vi.importActual<typeof import("@scouting-platform/integrations")>(
    "@scouting-platform/integrations",
  );

  return {
    ...actual,
    fetchYoutubeChannelContext: fetchYoutubeChannelContextMock,
    fetchYoutubeChannelPageEmailSignal: fetchYoutubeChannelPageEmailSignalMock,
    enrichChannelWithOpenAi: enrichChannelWithOpenAiMock,
    enrichCreatorProfilesWithOpenAi: enrichCreatorProfilesWithOpenAiMock,
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
  defaultLanguage: "en-US",
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
      durationSeconds: 605,
      isShort: false,
      categoryId: "20",
      categoryName: "Gaming",
      tags: ["gaming", "commentary"],
    },
    {
      youtubeVideoId: "video-2",
      title: "Second video",
      description: null,
      publishedAt: "2024-01-09T12:00:00Z",
      viewCount: 200,
      likeCount: 20,
      commentCount: 10,
      durationSeconds: 150,
      isShort: true,
      categoryId: "27",
      categoryName: "Education",
      tags: ["education"],
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
    structuredProfile: {
      primaryNiche: "gaming",
      secondaryNiches: ["commentary_reaction"],
      contentFormats: ["long_form", "live_stream"],
      brandFitTags: ["gaming_hardware", "consumer_tech"],
      language: "en",
      geoHints: ["US"],
      sponsorSignals: ["live-service game coverage"],
      brandSafety: {
        status: "low",
        flags: [],
        rationale: "No clear adult, gambling, or controversy signals in the provided sample.",
      },
    },
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

const LEGACY_STORED_OPENAI_RAW_PAYLOAD = {
  id: "resp-stored-legacy",
  choices: [
    {
      message: {
        content: JSON.stringify({
          summary: ENRICHMENT_RESULT.profile.summary,
          topics: ENRICHMENT_RESULT.profile.topics,
          brandFitNotes: ENRICHMENT_RESULT.profile.brandFitNotes,
          confidence: ENRICHMENT_RESULT.profile.confidence,
        }),
      },
    },
  ],
} as const;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function buildFreshMetricContext() {
  return {
    ...CACHED_CONTEXT,
    recentVideos: [
      {
        youtubeVideoId: "fresh-video-1",
        title: "Fresh long video one",
        description: "Fresh video description",
        publishedAt: daysAgoIso(7),
        viewCount: 1000,
        likeCount: 100,
        commentCount: 50,
        durationSeconds: 605,
        isShort: false,
        categoryId: "20",
        categoryName: "Gaming",
        tags: ["gaming", "commentary"],
      },
      {
        youtubeVideoId: "fresh-video-2",
        title: "Fresh long video two",
        description: null,
        publishedAt: daysAgoIso(14),
        viewCount: 3000,
        likeCount: 300,
        commentCount: 150,
        durationSeconds: 360,
        isShort: false,
        categoryId: "20",
        categoryName: "Gaming",
        tags: ["gaming"],
      },
      {
        youtubeVideoId: "fresh-short-1",
        title: "Fresh short one",
        description: null,
        publishedAt: daysAgoIso(21),
        viewCount: 500,
        likeCount: 50,
        commentCount: 25,
        durationSeconds: 45,
        isShort: true,
        categoryId: "27",
        categoryName: "Education",
        tags: ["education"],
      },
      {
        youtubeVideoId: "fresh-short-2",
        title: "Fresh short two",
        description: null,
        publishedAt: daysAgoIso(28),
        viewCount: 1500,
        likeCount: 150,
        commentCount: 75,
        durationSeconds: 60,
        isShort: true,
        categoryId: "27",
        categoryName: "Education",
        tags: ["education"],
      },
    ],
  };
}

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

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.APP_ENCRYPTION_KEY = "12345678901234567890123456789012";
    process.env.OPENAI_API_KEY = "test-openai-key";
    fetchYoutubeChannelContextMock.mockReset();
    fetchYoutubeChannelPageEmailSignalMock.mockReset();
    fetchYoutubeChannelPageEmailSignalMock.mockResolvedValue({
      fetchedUrl: null,
      emails: [],
      snippet: null,
    });
    enrichChannelWithOpenAiMock.mockReset();
    enrichCreatorProfilesWithOpenAiMock.mockReset();
    enrichCreatorProfilesWithOpenAiMock.mockResolvedValue([]);
    vi.resetModules();

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        dropdown_values,
        channel_enrichments,
        channel_youtube_contexts,
        channel_manual_overrides,
        csv_import_rows,
        csv_import_batches,
        hubspot_preview_enrichment_jobs,
        run_hubspot_row_overrides,
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

  async function createImportedChannelProvenance(input: {
    channelId: string;
    requestedByUserId: string;
    youtubeChannelId: string;
    title: string;
    createdAt?: Date;
  }): Promise<void> {
    const batch = await prisma.csvImportBatch.create({
      data: {
        requestedByUserId: input.requestedByUserId,
        fileName: "catalog.csv",
        templateVersion: "v3",
        status: PrismaCsvImportBatchStatus.COMPLETED,
        totalRowCount: 1,
        importedRowCount: 1,
        ...(input.createdAt ? { completedAt: input.createdAt } : {}),
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
      select: {
        id: true,
      },
    });

    await prisma.csvImportRow.create({
      data: {
        batchId: batch.id,
        rowNumber: 1,
        status: PrismaCsvImportRowStatus.IMPORTED,
        youtubeChannelId: input.youtubeChannelId,
        channelTitle: input.title,
        channelId: input.channelId,
      },
    });
  }

  async function createRunChannelProvenance(input: {
    channelId: string;
    requestedByUserId: string;
    createdAt?: Date;
  }): Promise<void> {
    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: input.requestedByUserId,
        name: "Discovery provenance run",
        query: "gaming creators",
        target: 1,
        status: RunRequestStatus.COMPLETED,
        ...(input.createdAt ? { completedAt: input.createdAt } : {}),
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
      select: {
        id: true,
      },
    });

    await prisma.runResult.create({
      data: {
        runRequestId: run.id,
        channelId: input.channelId,
        rank: 1,
        source: RunResultSource.DISCOVERY,
      },
    });
  }

  async function seedProfileDropdownValues(): Promise<void> {
    await prisma.dropdownValue.createMany({
      data: [
        { fieldKey: "INFLUENCER_TYPE", value: "Creator" },
        { fieldKey: "INFLUENCER_TYPE", value: "Streamer" },
        { fieldKey: "INFLUENCER_VERTICAL", value: "Gaming" },
        { fieldKey: "INFLUENCER_VERTICAL", value: "Tech" },
        { fieldKey: "COUNTRY_REGION", value: "United States" },
        { fieldKey: "COUNTRY_REGION", value: "Croatia" },
        { fieldKey: "LANGUAGE", value: "English" },
      ],
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

  it("queues missing and 365-day stale AI enrichments while refreshing 30-day stale YouTube context", async () => {
    const now = new Date("2026-05-04T10:00:00.000Z");
    const oldCompletedAt = new Date(now.getTime() - 366 * 24 * 60 * 60 * 1000);
    const freshCompletedAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const user = await createUser();
    const neverEnriched = await createChannel("UCaaaaaaaaaaaaaaaaaaaaaa", "Never Enriched");
    const discoveryOnly = await createChannel("UCeeeeeeeeeeeeeeeeeeeeee", "Discovery Only");
    const oldEnrichment = await createChannel("UCbbbbbbbbbbbbbbbbbbbbbb", "Old Enrichment");
    const freshEnrichment = await createChannel("UCcccccccccccccccccccccc", "Fresh Enrichment");
    const staleYoutubeContext = await createChannel("UCyyyyyyyyyyyyyyyyyyyyyy", "Stale YouTube");
    const runningEnrichment = await createChannel("UCdddddddddddddddddddddd", "Running Enrichment");
    const invalidYoutubeId = await createChannel("not-a-canonical-youtube-channel-id", "Invalid ID");
    await assignYoutubeKey(user.id);
    await createImportedChannelProvenance({
      channelId: neverEnriched.id,
      requestedByUserId: user.id,
      youtubeChannelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
      title: "Never Enriched",
      createdAt: new Date(now.getTime() - 2 * 60 * 1000),
    });
    await createRunChannelProvenance({
      channelId: discoveryOnly.id,
      requestedByUserId: user.id,
      createdAt: new Date(now.getTime() - 90 * 1000),
    });

    await prisma.channelEnrichment.create({
      data: {
        channelId: oldEnrichment.id,
        status: PrismaChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: user.id,
        requestedAt: new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000),
        completedAt: oldCompletedAt,
        lastEnrichedAt: oldCompletedAt,
        summary: "Old summary",
      },
    });
    await prisma.channelEnrichment.create({
      data: {
        channelId: freshEnrichment.id,
        status: PrismaChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: user.id,
        requestedAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
        completedAt: freshCompletedAt,
        lastEnrichedAt: freshCompletedAt,
        summary: "Fresh summary",
      },
    });
    await prisma.channelEnrichment.create({
      data: {
        channelId: staleYoutubeContext.id,
        status: PrismaChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: user.id,
        requestedAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
        completedAt: freshCompletedAt,
        lastEnrichedAt: freshCompletedAt,
        summary: "Fresh AI summary",
      },
    });
    await prisma.channelYoutubeContext.create({
      data: {
        channelId: staleYoutubeContext.id,
        context: CACHED_CONTEXT,
        fetchedAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.channelEnrichment.create({
      data: {
        channelId: runningEnrichment.id,
        status: PrismaChannelEnrichmentStatus.RUNNING,
        requestedByUserId: user.id,
        requestedAt: now,
        startedAt: now,
      },
    });
    await prisma.$executeRaw`
      UPDATE channels
      SET updated_at = ${new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)}
      WHERE id = ${freshEnrichment.id}::uuid
    `;

    const enqueuedPayloads: Array<{
      channelId: string;
      requestedByUserId: string;
    }> = [];
    const result = await getCore().queueDueChannelLlmEnrichments({
      batchSize: 10,
      now,
      enqueue: async (payload) => {
        enqueuedPayloads.push(payload);
      },
    });

    expect(result.missingYoutubeCredential).toBe(false);
    expect(result.queued).toBe(5);
    expect(result.queuedFull).toBe(3);
    expect(result.queuedYoutubeOnly).toBe(2);
    expect(result.queuedChannelIds.slice(0, 3)).toEqual([
      neverEnriched.id,
      discoveryOnly.id,
      oldEnrichment.id,
    ]);
    expect(new Set(result.queuedChannelIds.slice(3))).toEqual(
      new Set([staleYoutubeContext.id, freshEnrichment.id]),
    );
    expect(enqueuedPayloads.slice(0, 3)).toEqual([
      {
        channelId: neverEnriched.id,
        requestedByUserId: user.id,
      },
      {
        channelId: discoveryOnly.id,
        requestedByUserId: user.id,
      },
      {
        channelId: oldEnrichment.id,
        requestedByUserId: user.id,
      },
    ]);
    expect(new Set(enqueuedPayloads.slice(3).map((payload) => payload.channelId))).toEqual(
      new Set([staleYoutubeContext.id, freshEnrichment.id]),
    );
    expect(enqueuedPayloads.slice(3)).toEqual(
      expect.arrayContaining([
        {
          channelId: staleYoutubeContext.id,
          requestedByUserId: user.id,
          mode: "youtube_only",
        },
        {
          channelId: freshEnrichment.id,
          requestedByUserId: user.id,
          mode: "youtube_only",
        },
      ]),
    );

    const enrichments = await prisma.channelEnrichment.findMany({
      where: {
        channelId: {
          in: [
            neverEnriched.id,
            discoveryOnly.id,
            oldEnrichment.id,
            freshEnrichment.id,
            staleYoutubeContext.id,
            runningEnrichment.id,
            invalidYoutubeId.id,
          ],
        },
      },
    });
    const statusByChannelId = new Map(
      enrichments.map((enrichment) => [enrichment.channelId, enrichment.status]),
    );

    expect(statusByChannelId.get(neverEnriched.id)).toBe(PrismaChannelEnrichmentStatus.QUEUED);
    expect(statusByChannelId.get(discoveryOnly.id)).toBe(PrismaChannelEnrichmentStatus.QUEUED);
    expect(statusByChannelId.get(oldEnrichment.id)).toBe(PrismaChannelEnrichmentStatus.QUEUED);
    expect(statusByChannelId.get(freshEnrichment.id)).toBe(
      PrismaChannelEnrichmentStatus.COMPLETED,
    );
    expect(statusByChannelId.get(staleYoutubeContext.id)).toBe(
      PrismaChannelEnrichmentStatus.COMPLETED,
    );
    expect(statusByChannelId.get(runningEnrichment.id)).toBe(
      PrismaChannelEnrichmentStatus.RUNNING,
    );
    expect(statusByChannelId.has(invalidYoutubeId.id)).toBe(false);

    const staleYoutubeContextRow = await prisma.channelYoutubeContext.findUniqueOrThrow({
      where: {
        channelId: staleYoutubeContext.id,
      },
    });
    expect(staleYoutubeContextRow.refreshStatus).toBe(PrismaChannelYoutubeRefreshStatus.QUEUED);
    expect(staleYoutubeContextRow.refreshRequestedAt).toEqual(now);

    const freshYoutubeContextRow = await prisma.channelYoutubeContext.findUniqueOrThrow({
      where: {
        channelId: freshEnrichment.id,
      },
    });
    expect(freshYoutubeContextRow.refreshStatus).toBe(PrismaChannelYoutubeRefreshStatus.QUEUED);
    expect(freshYoutubeContextRow.refreshRequestedAt).toEqual(now);
  });

  it("does not queue continuous enrichment with an unrelated fallback credential", async () => {
    const unrelatedUser = await createUser("unrelated@example.com");
    const channel = await createChannel("UCeeeeeeeeeeeeeeeeeeeeee", "No Provenance");
    await assignYoutubeKey(unrelatedUser.id);

    const result = await getCore().queueDueChannelLlmEnrichments({
      batchSize: 10,
      now: new Date("2026-05-04T10:00:00.000Z"),
      enqueue: async () => {
        throw new Error("Should not enqueue without channel-related provenance");
      },
    });

    expect(result).toMatchObject({
      queued: 0,
      skipped: 0,
      failed: 0,
      missingYoutubeCredential: false,
    });

    await expect(
      prisma.channelEnrichment.findUnique({
        where: {
          channelId: channel.id,
        },
      }),
    ).resolves.toBeNull();
  });

  it("uses import provenance instead of a previous untrusted continuous requester", async () => {
    const now = new Date("2026-05-04T10:00:00.000Z");
    const wrongUser = await createUser("wrong@example.com");
    const importer = await createUser("importer@example.com");
    const channel = await createChannel("UCffffffffffffffffffffff", "Imported Channel");
    await assignYoutubeKey(wrongUser.id);
    await assignYoutubeKey(importer.id);
    await createImportedChannelProvenance({
      channelId: channel.id,
      requestedByUserId: importer.id,
      youtubeChannelId: "UCffffffffffffffffffffff",
      title: "Imported Channel",
      createdAt: new Date(now.getTime() - 3 * 60 * 1000),
    });
    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: PrismaChannelEnrichmentStatus.FAILED,
        requestedByUserId: wrongUser.id,
        requestedAt: new Date(now.getTime() - 5 * 60 * 1000),
        startedAt: new Date(now.getTime() - 5 * 60 * 1000),
        lastError: "Previous automatic attempt used an unrelated key",
      },
    });

    const enqueuedPayloads: Array<{
      channelId: string;
      requestedByUserId: string;
    }> = [];
    const result = await getCore().queueDueChannelLlmEnrichments({
      batchSize: 10,
      now,
      enqueue: async (payload) => {
        enqueuedPayloads.push(payload);
      },
    });

    expect(result.queued).toBe(1);
    expect(enqueuedPayloads).toEqual([
      {
        channelId: channel.id,
        requestedByUserId: importer.id,
      },
    ]);

    const enrichment = await prisma.channelEnrichment.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(enrichment.requestedByUserId).toBe(importer.id);
  });

  it("requeues failed and stuck continuous enrichments with bounded retry state", async () => {
    const now = new Date("2026-05-04T10:00:00.000Z");
    const user = await createUser("retry@example.com");
    const retryableFailed = await createChannel("UCrrrrrrrrrrrrrrrrrrrrrr", "Retryable Failed");
    const maxedFailed = await createChannel("UCmmmmmmmmmmmmmmmmmmmmmm", "Maxed Failed");
    const stuckRunning = await createChannel("UCpppppppppppppppppppppp", "Stuck Running");
    const oldQueued = await createChannel("UCqqqqqqqqqqqqqqqqqqqqqq", "Old Queued");
    await assignYoutubeKey(user.id);

    for (const channel of [retryableFailed, maxedFailed, stuckRunning, oldQueued]) {
      await createRunChannelProvenance({
        channelId: channel.id,
        requestedByUserId: user.id,
        createdAt: new Date(now.getTime() - 60 * 60 * 1000),
      });
    }

    await prisma.channelEnrichment.createMany({
      data: [
        {
          channelId: retryableFailed.id,
          status: PrismaChannelEnrichmentStatus.FAILED,
          requestedByUserId: user.id,
          requestedAt: new Date(now.getTime() - 30 * 60 * 1000),
          retryCount: 1,
          nextRetryAt: new Date(now.getTime() - 1000),
          lastError: "temporary provider failure",
        },
        {
          channelId: maxedFailed.id,
          status: PrismaChannelEnrichmentStatus.FAILED,
          requestedByUserId: user.id,
          requestedAt: new Date(now.getTime() - 30 * 60 * 1000),
          retryCount: 5,
          nextRetryAt: new Date(now.getTime() - 1000),
          lastError: "permanent provider failure",
        },
        {
          channelId: stuckRunning.id,
          status: PrismaChannelEnrichmentStatus.RUNNING,
          requestedByUserId: user.id,
          requestedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
          startedAt: new Date(now.getTime() - 61 * 60 * 1000),
          retryCount: 0,
        },
        {
          channelId: oldQueued.id,
          status: PrismaChannelEnrichmentStatus.QUEUED,
          requestedByUserId: user.id,
          requestedAt: new Date(now.getTime() - 20 * 60 * 1000),
          retryCount: 0,
        },
      ],
    });

    const enqueuedPayloads: Array<{
      channelId: string;
      requestedByUserId: string;
    }> = [];
    const result = await getCore().queueDueChannelLlmEnrichments({
      batchSize: 10,
      maxRetryCount: 5,
      processingTimeoutMs: 30 * 60 * 1000,
      queuedTimeoutMs: 10 * 60 * 1000,
      now,
      enqueue: async (payload) => {
        enqueuedPayloads.push(payload);
      },
    });

    expect(result.queuedChannelIds).toEqual([
      retryableFailed.id,
      oldQueued.id,
      stuckRunning.id,
      maxedFailed.id,
    ]);
    expect(enqueuedPayloads).toHaveLength(4);
    expect(enqueuedPayloads.at(-1)).toEqual({
      channelId: maxedFailed.id,
      requestedByUserId: user.id,
      mode: "youtube_only",
    });

    const enrichments = await prisma.channelEnrichment.findMany({
      where: {
        channelId: {
          in: [retryableFailed.id, maxedFailed.id, stuckRunning.id, oldQueued.id],
        },
      },
    });
    const byChannelId = new Map(enrichments.map((enrichment) => [enrichment.channelId, enrichment]));

    expect(byChannelId.get(retryableFailed.id)?.status).toBe(PrismaChannelEnrichmentStatus.QUEUED);
    expect(byChannelId.get(retryableFailed.id)?.retryCount).toBe(1);
    expect(byChannelId.get(retryableFailed.id)?.nextRetryAt).toBeNull();
    expect(byChannelId.get(maxedFailed.id)?.status).toBe(PrismaChannelEnrichmentStatus.FAILED);
    expect(byChannelId.get(stuckRunning.id)?.status).toBe(PrismaChannelEnrichmentStatus.QUEUED);
    expect(byChannelId.get(stuckRunning.id)?.retryCount).toBe(1);
    expect(byChannelId.get(oldQueued.id)?.status).toBe(PrismaChannelEnrichmentStatus.QUEUED);

    const maxedYoutubeContext = await prisma.channelYoutubeContext.findUniqueOrThrow({
      where: {
        channelId: maxedFailed.id,
      },
    });
    expect(maxedYoutubeContext.refreshStatus).toBe(PrismaChannelYoutubeRefreshStatus.QUEUED);
  });

  it("skips continuous enrichment scans when no YouTube credential is available", async () => {
    const channel = await createChannel("UCeeeeeeeeeeeeeeeeeeeeee", "No Key");
    const result = await getCore().queueDueChannelLlmEnrichments({
      batchSize: 10,
      now: new Date("2026-05-04T10:00:00.000Z"),
      enqueue: async () => {
        throw new Error("Should not enqueue without a credential");
      },
    });

    expect(result).toMatchObject({
      queued: 0,
      skipped: 0,
      failed: 0,
      missingYoutubeCredential: true,
    });

    await expect(
      prisma.channelEnrichment.findUnique({
        where: {
          channelId: channel.id,
        },
      }),
    ).resolves.toBeNull();
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
        youtubeContext: expect.objectContaining(CACHED_CONTEXT),
        derivedSignals: expect.objectContaining({
          topKeywords: expect.any(Array),
          topicClusters: expect.any(Array),
        }),
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

    const youtubeContext = buildFreshMetricContext();
    fetchYoutubeChannelContextMock.mockResolvedValue(youtubeContext);
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
    expect(contextRow.context).toMatchObject(youtubeContext);

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
    expect(metrics.youtubeFollowers).toBe(1200n);
    expect(metrics.youtubeEngagementRate).toBeCloseTo(15, 5);
    expect(metrics.youtubeVideoMedianViews).toBe(2000n);
    expect(metrics.youtubeShortsMedianViews).toBe(1000n);

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
    expect(enrichment.structuredProfile).toEqual(ENRICHMENT_RESULT.profile.structuredProfile);
    expect(enrichment.lastError).toBeNull();
    expect(enrichment.rawOpenaiPayload).toMatchObject(ENRICHMENT_RESULT.rawPayload);

    await prisma.channelEnrichment.update({
      where: {
        channelId: channel.id,
      },
      data: {
        status: PrismaChannelEnrichmentStatus.QUEUED,
      },
    });
    await prisma.channelYoutubeContext.update({
      where: {
        channelId: channel.id,
      },
      data: {
        fetchedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      },
    });

    fetchYoutubeChannelContextMock.mockResolvedValueOnce({
      ...youtubeContext,
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

  it("populates CRM profile fields from exact HubSpot dropdown options during channel enrichment", async () => {
    const user = await createUser("profile-fields@example.com");
    const channel = await createChannel("UC-PROFILE-FIELDS", "Profile Fields Channel");
    await assignYoutubeKey(user.id);
    await seedProfileDropdownValues();

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
      youtubeChannelId: "UC-PROFILE-FIELDS",
      description: "Gaming hardware reviews. Contact collabs@example.com for campaigns.",
      defaultLanguage: "en-US",
      recentVideos: CACHED_CONTEXT.recentVideos.map((video) => ({
        ...video,
        categoryName: "Gaming",
        tags: ["gaming", "hardware"],
      })),
    });
    enrichChannelWithOpenAiMock.mockResolvedValue({
      ...ENRICHMENT_RESULT,
      profile: {
        ...ENRICHMENT_RESULT.profile,
        topics: ["gaming hardware", "pc builds"],
        structuredProfile: {
          ...ENRICHMENT_RESULT.profile.structuredProfile,
          geoHints: ["US"],
        },
        crmClassifications: {
          influencerType: "Creator",
          verticals: ["Gaming", "Tech"],
          countryRegion: "United States",
          language: "English",
        },
      },
    });

    await getCore().executeChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    const persistedChannel = await prisma.channel.findUniqueOrThrow({
      where: {
        id: channel.id,
      },
      select: {
        influencerType: true,
        influencerVertical: true,
        countryRegion: true,
        contentLanguage: true,
        contacts: {
          select: {
            email: true,
          },
        },
      },
    });

    expect(enrichChannelWithOpenAiMock).toHaveBeenCalledTimes(1);
    expect(enrichChannelWithOpenAiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        crmDropdownOptions: {
          influencerType: ["Creator", "Streamer"],
          influencerVertical: ["Gaming", "Tech"],
          countryRegion: ["Croatia", "United States"],
          language: ["English"],
        },
      }),
    );
    expect(persistedChannel.influencerType).toBe("Creator");
    expect(persistedChannel.influencerVertical).toBe("Gaming");
    expect(persistedChannel.countryRegion).toBe("United States");
    expect(persistedChannel.contentLanguage).toBe("English");
    expect(persistedChannel.contacts.map((contact) => contact.email)).toEqual([
      "collabs@example.com",
    ]);
  });

  it("preserves existing valid CRM classifications during enrichment", async () => {
    const user = await createUser("preserve-profile-fields@example.com");
    const channel = await createChannel("UC-PRESERVE-PROFILE", "Preserve Profile Channel");
    await assignYoutubeKey(user.id);
    await seedProfileDropdownValues();
    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        influencerType: "Streamer",
        influencerVertical: "Tech",
        countryRegion: "Croatia",
        contentLanguage: "English",
      },
    });
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
      youtubeChannelId: "UC-PRESERVE-PROFILE",
      defaultLanguage: "hr",
    });
    enrichChannelWithOpenAiMock.mockResolvedValue({
      ...ENRICHMENT_RESULT,
      profile: {
        ...ENRICHMENT_RESULT.profile,
        crmClassifications: {
          influencerType: "Creator",
          verticals: ["Gaming"],
          countryRegion: "United States",
          language: "English",
        },
      },
    });

    await getCore().executeChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    await expect(prisma.channel.findUniqueOrThrow({
      where: { id: channel.id },
      select: {
        influencerType: true,
        influencerVertical: true,
        countryRegion: true,
        contentLanguage: true,
      },
    })).resolves.toEqual({
      influencerType: "Streamer",
      influencerVertical: "Tech",
      countryRegion: "Croatia",
      contentLanguage: "English",
    });
  });

  it("persists YouTube medians when Creator List preview refresh writes metrics", async () => {
    const user = await createUser("preview-refresh@example.com");
    const channel = await createChannel("UC-PREVIEW-MEDIANS", "Preview Median Channel");
    await assignYoutubeKey(user.id);

    await prisma.channelMetric.create({
      data: {
        channelId: channel.id,
        youtubeFollowers: 99n,
        youtubeVideoMedianViews: 99n,
        youtubeShortsMedianViews: 99n,
      },
    });
    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: user.id,
        name: "Preview enrichment run",
        query: "gaming creators",
        target: 1,
        status: RunRequestStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
    await prisma.runResult.create({
      data: {
        runRequestId: run.id,
        channelId: channel.id,
        rank: 1,
        source: RunResultSource.DISCOVERY,
      },
    });
    const job = await prisma.hubspotPreviewEnrichmentJob.create({
      data: {
        runRequestId: run.id,
        requestedByUserId: user.id,
        progressMessage: "Creator List enrichment queued.",
      },
    });

    fetchYoutubeChannelContextMock.mockResolvedValueOnce(buildFreshMetricContext());

    await getCore().executeHubspotPreviewEnrichmentJob({
      enrichmentJobId: job.id,
      requestedByUserId: user.id,
    });

    const metrics = await prisma.channelMetric.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(metrics.youtubeFollowers).toBe(1200n);
    expect(metrics.youtubeVideoMedianViews).toBe(2000n);
    expect(metrics.youtubeShortsMedianViews).toBe(1000n);

    const completedJob = await prisma.hubspotPreviewEnrichmentJob.findUniqueOrThrow({
      where: {
        id: job.id,
      },
    });
    expect(completedJob.status).toBe(PrismaHubspotPreviewEnrichmentJobStatus.COMPLETED);
  });

  it("normalizes Creator List batch enrichment to saved HubSpot dropdown values", async () => {
    const user = await createUser("preview-profile-fields@example.com");
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-PREVIEW-PROFILE",
        title: "Preview Profile Channel",
        influencerVertical: "Strategy",
        countryRegion: "US",
      },
      select: {
        id: true,
      },
    });
    await assignYoutubeKey(user.id);
    await seedProfileDropdownValues();

    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: user.id,
        name: "Preview profile run",
        query: "gaming creators",
        target: 1,
        status: RunRequestStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
    const runResult = await prisma.runResult.create({
      data: {
        runRequestId: run.id,
        channelId: channel.id,
        rank: 1,
        source: RunResultSource.DISCOVERY,
      },
      select: {
        id: true,
      },
    });
    const job = await prisma.hubspotPreviewEnrichmentJob.create({
      data: {
        runRequestId: run.id,
        requestedByUserId: user.id,
        progressMessage: "Creator List enrichment queued.",
      },
    });

    fetchYoutubeChannelContextMock.mockResolvedValueOnce({
      ...buildFreshMetricContext(),
      youtubeChannelId: "UC-PREVIEW-PROFILE",
      description: "Gaming creator. Business: batch@example.com",
    });
    enrichCreatorProfilesWithOpenAiMock.mockResolvedValueOnce([
      {
        rowKey: `${runResult.id}:0`,
        values: {
          "First Name": "Alex",
          "Last Name": "Creator",
          Email: "",
          "Influencer Type": "Creator",
          "Influencer Vertical": "Gaming",
          "Country/Region": "United States",
          Language: "English",
        },
      },
    ]);

    await getCore().executeHubspotPreviewEnrichmentJob({
      enrichmentJobId: job.id,
      requestedByUserId: user.id,
    });

    const preview = await getCore().getHubspotExportPreview({
      runId: run.id,
      userId: user.id,
      role: "admin",
    });
    const [row] = preview.rows;

    expect(row?.values.email).toBe("batch@example.com");
    expect(row?.values.firstName).toBe("Alex");
    expect(row?.values.lastName).toBe("Creator");
    expect(row?.values.influencerType).toBe("Creator");
    expect(row?.values.influencerVertical).toBe("Gaming");
    expect(row?.values.countryRegion).toBe("United States");
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
          durationSeconds: null,
          isShort: null,
          viewCount: null,
          likeCount: null,
          commentCount: null,
          categoryId: null,
          categoryName: null,
          tags: [],
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
    expect(enrichment.lastEnrichedAt).toBeNull();
    expect(enrichment.retryCount).toBe(1);
    expect(enrichment.nextRetryAt).not.toBeNull();
  });

  it("completes enrichment when channel-page extraction times out", async () => {
    const user = await createUser("page-timeout@example.com");
    const channel = await createChannel("UC-PAGE-TIMEOUT", "Page Timeout Channel");
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
    fetchYoutubeChannelPageEmailSignalMock.mockRejectedValue(new Error("page timed out"));

    await getCore().executeChannelLlmEnrichment({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    const enrichment = await prisma.channelEnrichment.findUniqueOrThrow({
      where: { channelId: channel.id },
    });
    expect(enrichment.status).toBe(PrismaChannelEnrichmentStatus.COMPLETED);
    expect(enrichment.lastError).toBeNull();
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
        status: PrismaChannelEnrichmentStatus.QUEUED,
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
    expect(fetchYoutubeChannelPageEmailSignalMock).not.toHaveBeenCalled();

    const enrichment = await prisma.channelEnrichment.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(enrichment.status).toBe(PrismaChannelEnrichmentStatus.COMPLETED);
    expect(enrichment.summary).toBe(ENRICHMENT_RESULT.profile.summary);
    expect(enrichment.brandFitNotes).toBe(ENRICHMENT_RESULT.profile.brandFitNotes);
    expect(enrichment.confidence).toBe(ENRICHMENT_RESULT.profile.confidence);
    expect(enrichment.structuredProfile).toEqual(ENRICHMENT_RESULT.profile.structuredProfile);
  });

  it("completes legacy stored payload reuse with structuredProfile set to null", async () => {
    const user = await createUser();
    const channel = await createChannel("UC-ENRICH-REUSE-LEGACY", "Reuse Legacy Channel");
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
        status: PrismaChannelEnrichmentStatus.QUEUED,
        requestedByUserId: user.id,
        requestedAt: new Date(),
        rawOpenaiPayload: LEGACY_STORED_OPENAI_RAW_PAYLOAD,
        rawOpenaiPayloadFetchedAt: new Date(),
      },
    });

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
    expect(enrichment.summary).toBe(ENRICHMENT_RESULT.profile.summary);
    expect(enrichment.structuredProfile).toBeNull();
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
        status: PrismaChannelEnrichmentStatus.QUEUED,
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

  it("refreshes YouTube-only signals without calling OpenAI or changing AI freshness", async () => {
    const user = await createUser("youtube-only@example.com");
    const channel = await createChannel("UC-YOUTUBE-ONLY-REFRESH", "YouTube Only Refresh");
    const lastEnrichedAt = new Date("2026-01-15T10:00:00.000Z");
    await assignYoutubeKey(user.id);

    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: PrismaChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: user.id,
        requestedAt: new Date("2026-01-15T09:59:00.000Z"),
        completedAt: lastEnrichedAt,
        lastEnrichedAt,
        summary: "Existing AI summary",
      },
    });
    await prisma.channelYoutubeContext.create({
      data: {
        channelId: channel.id,
        context: CACHED_CONTEXT,
        fetchedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        refreshStatus: PrismaChannelYoutubeRefreshStatus.QUEUED,
        refreshRequestedAt: new Date(),
      },
    });

    fetchYoutubeChannelContextMock.mockResolvedValueOnce({
      ...buildFreshMetricContext(),
      title: "YouTube Only Refreshed",
      handle: "@youtube-only-refreshed",
      subscriberCount: 2400,
    });

    await getCore().executeChannelYoutubeRefresh({
      channelId: channel.id,
      requestedByUserId: user.id,
    });

    expect(fetchYoutubeChannelContextMock).toHaveBeenCalledTimes(1);
    expect(enrichChannelWithOpenAiMock).not.toHaveBeenCalled();

    const enrichment = await prisma.channelEnrichment.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(enrichment.status).toBe(PrismaChannelEnrichmentStatus.COMPLETED);
    expect(enrichment.lastEnrichedAt).toEqual(lastEnrichedAt);

    const context = await prisma.channelYoutubeContext.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(context.refreshStatus).toBe(PrismaChannelYoutubeRefreshStatus.COMPLETED);
    expect(context.refreshCompletedAt).not.toBeNull();
    expect(context.refreshRetryCount).toBe(0);
    expect(context.refreshNextRetryAt).toBeNull();
    expect(context.lastError).toBeNull();
    expect(context.context).toMatchObject({
      title: "YouTube Only Refreshed",
      handle: "@youtube-only-refreshed",
      subscriberCount: 2400,
    });

    const metrics = await prisma.channelMetric.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(metrics.youtubeFollowers).toBe(2400n);
    expect(metrics.youtubeVideoMedianViews).toBe(2000n);
    expect(metrics.youtubeShortsMedianViews).toBe(1000n);

    // The catalog detail must surface the YouTube refresh timestamp separately
    // from the AI enrichment timestamp so the two cadences are visible.
    const detail = await getCore().getChannelById(channel.id);
    expect(detail?.enrichment.lastEnrichedAt).toEqual(lastEnrichedAt.toISOString());
    expect(detail?.enrichment.youtubeRefreshedAt).not.toBeNull();
    expect(
      new Date(detail!.enrichment.youtubeRefreshedAt!).getTime(),
    ).toBeGreaterThan(lastEnrichedAt.getTime());
  });

  it("persists failed YouTube-only refresh state and retry timing", async () => {
    const user = await createUser("youtube-only-failure@example.com");
    const channel = await createChannel("UC-YOUTUBE-ONLY-FAIL", "YouTube Only Failure");
    await assignYoutubeKey(user.id);
    await prisma.channelYoutubeContext.create({
      data: {
        channelId: channel.id,
        context: CACHED_CONTEXT,
        fetchedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        refreshStatus: PrismaChannelYoutubeRefreshStatus.QUEUED,
        refreshRequestedAt: new Date(),
      },
    });

    fetchYoutubeChannelContextMock.mockRejectedValueOnce(
      new (await import("@scouting-platform/integrations")).YoutubeChannelContextProviderError(
        "YOUTUBE_QUOTA_EXCEEDED",
        429,
        "YouTube context rate limited",
      ),
    );

    await expect(
      getCore().executeChannelYoutubeRefresh({
        channelId: channel.id,
        requestedByUserId: user.id,
      }),
    ).rejects.toMatchObject({
      code: "YOUTUBE_QUOTA_EXCEEDED",
      status: 429,
    });

    const context = await prisma.channelYoutubeContext.findUniqueOrThrow({
      where: {
        channelId: channel.id,
      },
    });
    expect(context.refreshStatus).toBe(PrismaChannelYoutubeRefreshStatus.FAILED);
    expect(context.refreshRetryCount).toBe(1);
    expect(context.refreshNextRetryAt).not.toBeNull();
    expect(context.lastError).toContain("YouTube context rate limited");
  });

  it("replaces URL-only placeholder channel titles with the YouTube channel name during enrichment", async () => {
    const user = await createUser("url-title@example.com");
    const channel = await createChannel("UC-ENRICH-1", "@channel-name");
    await assignYoutubeKey(user.id);

    await prisma.channel.update({
      where: {
        id: channel.id,
      },
      data: {
        handle: "@channel-name",
        youtubeUrl: "https://www.youtube.com/@channel-name",
      },
    });
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

    const updatedChannel = await prisma.channel.findUniqueOrThrow({
      where: {
        id: channel.id,
      },
      select: {
        title: true,
      },
    });
    expect(updatedChannel.title).toBe("Channel Name");
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
    await db.prisma.$connect();
    const cachedPrisma = (
      globalThis as typeof globalThis & {
        __scoutingPrisma?: PrismaClient;
      }
    ).__scoutingPrisma;

    if (!cachedPrisma) {
      throw new Error("Expected @scouting-platform/db prisma client to be initialized");
    }

    const originalTransaction = cachedPrisma.$transaction.bind(cachedPrisma);
    const transactionSpy = vi.spyOn(cachedPrisma, "$transaction");
    transactionSpy.mockImplementation((async (arg: unknown, ...rest: unknown[]) => {
      if (typeof arg === "function") {
        return originalTransaction(async (tx) => {
          await (arg as (client: unknown) => Promise<unknown>)(tx);
          throw new Error("final transaction boom");
        }, ...(rest as []));
      }

      return originalTransaction(arg as never, ...(rest as []));
    }) as typeof cachedPrisma.$transaction);

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

  it("keeps 31-day AI enrichment fresh and marks 366-day AI enrichment stale", async () => {
    const user = await createUser();
    const channelByAge = await createChannel("UC-STALE-AGE", "Old Completion");
    const channelByMonth = await createChannel("UC-FRESH-MONTH", "Month Old Completion");
    const channelByUpdate = await createChannel("UC-STALE-UPDATE", "Updated Channel");

    await prisma.channelEnrichment.create({
      data: {
        channelId: channelByAge.id,
        status: PrismaChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: user.id,
        requestedAt: new Date(Date.now() - 367 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 366 * 24 * 60 * 60 * 1000),
        lastEnrichedAt: new Date(Date.now() - 366 * 24 * 60 * 60 * 1000),
        summary: "Old summary",
        topics: ["gaming"],
        brandFitNotes: "Old notes",
        confidence: 0.5,
      },
    });
    await prisma.channelEnrichment.create({
      data: {
        channelId: channelByMonth.id,
        status: PrismaChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: user.id,
        requestedAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        lastEnrichedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        summary: "Month-old summary",
        topics: ["gaming"],
        brandFitNotes: "Month-old notes",
        confidence: 0.6,
      },
    });
    await prisma.channelEnrichment.create({
      data: {
        channelId: channelByUpdate.id,
        status: PrismaChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: user.id,
        requestedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        lastEnrichedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        summary: "Fresh-ish summary",
        topics: ["tech"],
        brandFitNotes: "Fresh-ish notes",
        confidence: 0.7,
      },
    });

    const staleByAge = await getCore().getChannelById(channelByAge.id);
    const freshByMonth = await getCore().getChannelById(channelByMonth.id);
    const staleByUpdate = await getCore().getChannelById(channelByUpdate.id);

    expect(staleByAge?.enrichment.status).toBe("stale");
    expect(freshByMonth?.enrichment.status).toBe("completed");
    expect(staleByUpdate?.enrichment.status).toBe("completed");
  });
});
