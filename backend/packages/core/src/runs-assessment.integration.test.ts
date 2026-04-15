import {
  Role,
  RunChannelAssessmentStatus,
  RunRequestStatus,
  RunResultSource,
  type PrismaClient,
} from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const enrichCampaignFitWithOpenAiMock = vi.fn();

vi.mock("@scouting-platform/integrations", async () => {
  const actual = await vi.importActual<typeof import("@scouting-platform/integrations")>(
    "@scouting-platform/integrations",
  );

  return {
    ...actual,
    enrichCampaignFitWithOpenAi: enrichCampaignFitWithOpenAiMock,
  };
});

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type CoreModule = typeof import("./index");

const MOCK_RESULT = {
  profile: {
    fitScore: 0.78,
    fitReasons: ["Audience overlaps with the brief."],
    fitConcerns: ["Limited evidence of local-language reach."],
    recommendedAngles: ["Hands-on benchmark narrative."],
    avoidTopics: ["Off-brief family content."],
  },
  rawPayload: {
    id: "resp-1",
    choices: [
      {
        message: {
          content: JSON.stringify({
            fitScore: 0.78,
            fitReasons: ["Audience overlaps with the brief."],
            fitConcerns: ["Limited evidence of local-language reach."],
            recommendedAngles: ["Hands-on benchmark narrative."],
            avoidTopics: ["Off-brief family content."],
          }),
        },
      },
    ],
  },
  model: "gpt-4.1-mini" as const,
};

integration("run assessment core integration", () => {
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
    vi.resetModules();
    enrichCampaignFitWithOpenAiMock.mockReset();
    enrichCampaignFitWithOpenAiMock.mockResolvedValue(MOCK_RESULT);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        run_channel_assessments,
        channel_enrichments,
        channel_youtube_contexts,
        run_results,
        run_requests,
        campaigns,
        markets,
        clients,
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
      DELETE FROM pgboss.job WHERE name = 'runs.assess.channel-fit'
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

  async function seedRunWithBrief() {
    const user = await prisma.user.create({
      data: {
        email: "manager@example.com",
        name: "Manager",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
    });
    const client = await prisma.client.create({
      data: {
        name: "NVIDIA",
      },
    });
    const market = await prisma.market.create({
      data: {
        name: "DACH",
      },
    });
    const campaign = await prisma.campaign.create({
      data: {
        name: "RTX Launch",
        clientId: client.id,
        marketId: market.id,
        month: "APRIL",
        year: 2026,
        isActive: true,
      },
    });
    const [channelA, channelB] = await prisma.$transaction([
      prisma.channel.create({
        data: {
          youtubeChannelId: "UC-ASSESS-1",
          title: "Assess Channel 1",
          handle: "@assess1",
        },
      }),
      prisma.channel.create({
        data: {
          youtubeChannelId: "UC-ASSESS-2",
          title: "Assess Channel 2",
          handle: "@assess2",
        },
      }),
    ]);
    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: user.id,
        name: "GPU Campaign",
        query: "gaming creators",
        target: 2,
        campaignId: campaign.id,
        client: "NVIDIA",
        market: "DACH",
        campaignName: "RTX Launch",
        status: RunRequestStatus.COMPLETED,
        clientIndustry: "Gaming Hardware",
        campaignObjective: "Drive awareness for a new GPU launch",
        targetAudienceAge: "18-34",
        targetAudienceGender: "All",
        targetGeographies: ["Germany", "Austria"],
        contentRestrictions: ["No political content"],
        budgetTier: "mid",
        deliverables: ["Dedicated video", "Short-form cutdown"],
      },
    });
    await prisma.runResult.createMany({
      data: [
        {
          runRequestId: run.id,
          channelId: channelA.id,
          rank: 1,
          source: RunResultSource.CATALOG,
        },
        {
          runRequestId: run.id,
          channelId: channelB.id,
          rank: 2,
          source: RunResultSource.DISCOVERY,
        },
      ],
    });

    return { user, run, channelA, channelB };
  }

  it("queues assessment rows and completes them through the executor", async () => {
    const { user, run, channelA, channelB } = await seedRunWithBrief();

    const requested = await getCore().requestRunAssessment({
      runId: run.id,
      userId: user.id,
      role: "user",
    });

    expect(requested.enqueued).toBe(2);

    const queuedRows = await prisma.runChannelAssessment.findMany({
      where: {
        runRequestId: run.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    expect(queuedRows).toHaveLength(2);
    expect(queuedRows.every((row) => row.status === RunChannelAssessmentStatus.QUEUED)).toBe(true);

    await getCore().executeRunChannelFitAssessment({
      runRequestId: run.id,
      channelId: channelA.id,
      requestedByUserId: user.id,
    });
    await getCore().executeRunChannelFitAssessment({
      runRequestId: run.id,
      channelId: channelB.id,
      requestedByUserId: user.id,
    });

    const completedRows = await prisma.runChannelAssessment.findMany({
      where: {
        runRequestId: run.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    expect(completedRows.every((row) => row.status === RunChannelAssessmentStatus.COMPLETED)).toBe(
      true,
    );
    expect(completedRows.every((row) => row.model === "gpt-4.1-mini")).toBe(true);
    expect(completedRows.every((row) => row.assessedAt instanceof Date)).toBe(true);
    expect(enrichCampaignFitWithOpenAiMock).toHaveBeenCalledTimes(2);
  });

  it("requeues completed rows and clears cached payloads so retriggers assess against the new brief", async () => {
    const { user, run, channelA, channelB } = await seedRunWithBrief();

    await getCore().requestRunAssessment({
      runId: run.id,
      userId: user.id,
      role: "user",
    });

    await getCore().executeRunChannelFitAssessment({
      runRequestId: run.id,
      channelId: channelA.id,
      requestedByUserId: user.id,
    });
    await getCore().executeRunChannelFitAssessment({
      runRequestId: run.id,
      channelId: channelB.id,
      requestedByUserId: user.id,
    });

    enrichCampaignFitWithOpenAiMock.mockClear();

    const retriggered = await getCore().requestRunAssessment({
      runId: run.id,
      userId: user.id,
      role: "user",
    });

    expect(retriggered.enqueued).toBe(2);

    const requeuedRows = await prisma.runChannelAssessment.findMany({
      where: {
        runRequestId: run.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    expect(requeuedRows.every((row) => row.status === RunChannelAssessmentStatus.QUEUED)).toBe(
      true,
    );
    expect(requeuedRows.every((row) => row.assessedAt === null)).toBe(true);
    expect(requeuedRows.every((row) => row.rawOpenaiPayload === null)).toBe(true);
    expect(requeuedRows.every((row) => row.rawOpenaiPayloadFetchedAt === null)).toBe(true);

    await getCore().executeRunChannelFitAssessment({
      runRequestId: run.id,
      channelId: channelA.id,
      requestedByUserId: user.id,
    });
    await getCore().executeRunChannelFitAssessment({
      runRequestId: run.id,
      channelId: channelB.id,
      requestedByUserId: user.id,
    });

    expect(enrichCampaignFitWithOpenAiMock).toHaveBeenCalledTimes(2);
  });
});
