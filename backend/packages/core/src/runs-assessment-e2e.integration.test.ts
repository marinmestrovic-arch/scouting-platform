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
type IntegrationsModule = typeof import("@scouting-platform/integrations");

function buildMockAssessment(overrides?: Partial<Awaited<ReturnType<IntegrationsModule["enrichCampaignFitWithOpenAi"]>>["profile"]>) {
  const profile = {
    fitScore: 0.75,
    fitReasons: ["Aligned audience"],
    fitConcerns: ["Some market mismatch"],
    recommendedAngles: ["Hands-on demo"],
    avoidTopics: ["Off-brief content"],
    ...(overrides ?? {}),
  };

  return {
    profile,
    rawPayload: {
      choices: [
        {
          message: {
            content: JSON.stringify(profile),
          },
        },
      ],
    },
    model: "gpt-4.1-mini" as const,
  };
}

integration("run assessment end-to-end core integration", () => {
  let prisma: PrismaClient;
  let core: CoreModule | null = null;
  let integrations: IntegrationsModule | null = null;

  function getCore(): CoreModule {
    if (!core) {
      throw new Error("Expected core module to be loaded");
    }

    return core;
  }

  function getIntegrations(): IntegrationsModule {
    if (!integrations) {
      throw new Error("Expected integrations module to be loaded");
    }

    return integrations;
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
    enrichCampaignFitWithOpenAiMock
      .mockResolvedValueOnce(buildMockAssessment({ fitScore: 0.75, fitReasons: ["Aligned audience"] }))
      .mockResolvedValueOnce(
        buildMockAssessment({ fitScore: 0.3, fitReasons: ["Audience mismatch"] }),
      );

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
    integrations = await import("@scouting-platform/integrations");
  });

  afterEach(async () => {
    await core?.stopRunsQueue();
    core = null;
    integrations = null;
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
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `manager-${Math.random()}@example.com`,
          name: "Manager",
          role: Role.USER,
          passwordHash: "hash",
          isActive: true,
        },
      });
      const client = await tx.client.create({
        data: {
          name: `NVIDIA-${Math.random()}`,
        },
      });
      const market = await tx.market.create({
        data: {
          name: `DACH-${Math.random()}`,
        },
      });
      const campaign = await tx.campaign.create({
        data: {
          name: `RTX Launch-${Math.random()}`,
          clientId: client.id,
          marketId: market.id,
          month: "APRIL",
          year: 2026,
          isActive: true,
        },
      });
      const channelA = await tx.channel.create({
        data: {
          youtubeChannelId: `UC-E2E-1-${Math.random()}`,
          title: "E2E Channel 1",
        },
      });
      const channelB = await tx.channel.create({
        data: {
          youtubeChannelId: `UC-E2E-2-${Math.random()}`,
          title: "E2E Channel 2",
        },
      });
      const run = await tx.runRequest.create({
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
      await tx.runResult.createMany({
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
    });
  }

  it("runs the full request -> execute -> read -> retrigger flow", async () => {
    const { user, run, channelA, channelB } = await seedRunWithBrief();

    const requested = await getCore().requestRunAssessment({
      runId: run.id,
      userId: user.id,
      role: "user",
    });

    expect(requested.enqueued).toBe(2);

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

    const completed = await prisma.runChannelAssessment.findMany({
      where: {
        runRequestId: run.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    expect(completed.map((row) => row.fitScore)).toEqual([0.75, 0.3]);
    expect(completed.every((row) => row.status === RunChannelAssessmentStatus.COMPLETED)).toBe(
      true,
    );

    const assessments = await getCore().getRunAssessments({
      runId: run.id,
      userId: user.id,
      role: "user",
    });
    expect(assessments).toHaveLength(2);
    const [firstAssessment, secondAssessment] = assessments;
    expect(firstAssessment).toBeDefined();
    expect(secondAssessment).toBeDefined();
    expect(firstAssessment!.createdAt >= secondAssessment!.createdAt).toBe(true);

    enrichCampaignFitWithOpenAiMock.mockClear();
    enrichCampaignFitWithOpenAiMock
      .mockResolvedValueOnce(buildMockAssessment({ fitScore: 0.61, fitReasons: ["Updated brief fit A"] }))
      .mockResolvedValueOnce(
        buildMockAssessment({ fitScore: 0.44, fitReasons: ["Updated brief fit B"] }),
      );

    await getCore().requestRunAssessment({
      runId: run.id,
      userId: user.id,
      role: "user",
    });

    let requeued = await prisma.runChannelAssessment.findMany({
      where: {
        runRequestId: run.id,
      },
    });
    expect(requeued.every((row) => row.status === RunChannelAssessmentStatus.QUEUED)).toBe(true);
    expect(requeued.every((row) => row.assessedAt === null)).toBe(true);
    expect(requeued.every((row) => row.rawOpenaiPayload === null)).toBe(true);
    expect(requeued.every((row) => row.rawOpenaiPayloadFetchedAt === null)).toBe(true);

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

    requeued = await prisma.runChannelAssessment.findMany({
      where: {
        runRequestId: run.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    expect(requeued.map((row) => row.fitScore)).toEqual([0.61, 0.44]);
    expect(enrichCampaignFitWithOpenAiMock).toHaveBeenCalledTimes(2);
  });

  it("marks the row failed and rethrows when the integration rate limits", async () => {
    const { user, run, channelA } = await seedRunWithBrief();
    await prisma.runChannelAssessment.create({
      data: {
        runRequestId: run.id,
        channelId: channelA.id,
        status: RunChannelAssessmentStatus.QUEUED,
      },
    });

    const { OpenAiCampaignFitError } = getIntegrations();
    const rateLimitError = new OpenAiCampaignFitError(
      "OPENAI_RATE_LIMITED",
      "rate limited",
      429,
    );
    enrichCampaignFitWithOpenAiMock.mockReset();
    enrichCampaignFitWithOpenAiMock.mockRejectedValueOnce(rateLimitError);

    await expect(
      getCore().executeRunChannelFitAssessment({
        runRequestId: run.id,
        channelId: channelA.id,
        requestedByUserId: user.id,
      }),
    ).rejects.toMatchObject({
      code: "OPENAI_RATE_LIMITED",
      status: 429,
    });

    const failed = await prisma.runChannelAssessment.findUniqueOrThrow({
      where: {
        runRequestId_channelId: {
          runRequestId: run.id,
          channelId: channelA.id,
        },
      },
    });
    expect(failed.status).toBe(RunChannelAssessmentStatus.FAILED);
    expect(failed.lastError).toContain("rate limited");
  });
});
