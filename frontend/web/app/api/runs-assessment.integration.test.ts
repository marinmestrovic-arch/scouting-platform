import {
  CredentialProvider,
  PrismaClient,
  Role,
  RunChannelAssessmentStatus,
  RunRequestStatus,
  RunResultSource,
} from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;
type CoreModule = typeof import("@scouting-platform/core");

let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

integration("run assessment API integration", () => {
  let prisma: PrismaClient;
  let core: CoreModule;
  let runsRoute: typeof import("./runs/route");
  let runDetailRoute: typeof import("./runs/[id]/route");
  let runAssessRoute: typeof import("./runs/[id]/assess/route");
  let runBriefRoute: typeof import("./runs/[id]/brief/route");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "runs-assessment-api-auth-secret";
    process.env.APP_ENCRYPTION_KEY = "12345678901234567890123456789012";

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
    core = await import("@scouting-platform/core");
    runsRoute = await import("./runs/route");
    runDetailRoute = await import("./runs/[id]/route");
    runAssessRoute = await import("./runs/[id]/assess/route");
    runBriefRoute = await import("./runs/[id]/brief/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;
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
      DELETE FROM pgboss.job
      WHERE name IN ('runs.discover', 'runs.assess.channel-fit')
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

  async function buildCampaign(campaignManagerUserId: string): Promise<{ campaignId: string }> {
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
        name: `Campaign ${campaignManagerUserId.slice(0, 8)} ${Math.random()}`,
        clientId: client.id,
        marketId: market.id,
        month: "APRIL",
        year: 2026,
        isActive: true,
      },
    });

    return {
      campaignId: campaign.id,
    };
  }

  async function createCompletedRunWithResults(ownerId: string, withBrief = true) {
    const campaign = await buildCampaign(ownerId);
    const [channelA, channelB] = await prisma.$transaction([
      prisma.channel.create({
        data: {
          youtubeChannelId: `UC-ASSESS-A-${Math.random()}`,
          title: "Assess Channel A",
          handle: "@assess-a",
        },
      }),
      prisma.channel.create({
        data: {
          youtubeChannelId: `UC-ASSESS-B-${Math.random()}`,
          title: "Assess Channel B",
          handle: "@assess-b",
        },
      }),
    ]);
    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: ownerId,
        name: "GPU Campaign",
        query: "gaming creators",
        target: 2,
        campaignId: campaign.campaignId,
        client: "NVIDIA",
        market: "DACH",
        campaignName: "RTX Launch",
        status: RunRequestStatus.COMPLETED,
        ...(withBrief
          ? {
              clientIndustry: "Gaming Hardware",
              campaignObjective: "Drive awareness for a new GPU launch",
              targetAudienceAge: "18-34",
              targetAudienceGender: "All",
              targetGeographies: ["Germany", "Austria"],
              contentRestrictions: ["No political content"],
              budgetTier: "mid",
              deliverables: ["Dedicated video"],
            }
          : {}),
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

    return { run, channelA, channelB };
  }

  function nextRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
    return new NextRequest(url, init);
  }

  it("returns 401 for unauthenticated assess and brief routes", async () => {
    const assessResponse = await runAssessRoute.POST(
      nextRequest("http://localhost/api/runs/6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b/assess", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b" }) },
    );
    expect(assessResponse.status).toBe(401);

    const briefResponse = await runBriefRoute.PATCH(
      nextRequest("http://localhost/api/runs/6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b/brief", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientIndustry: "Gaming" }),
      }),
      { params: Promise.resolve({ id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b" }) },
    );
    expect(briefResponse.status).toBe(401);
  });

  it("returns 403 for non-owner assess requests", async () => {
    const owner = await createUser("owner@example.com");
    const otherUser = await createUser("other@example.com");
    const { run } = await createCompletedRunWithResults(owner.id);

    currentSessionUser = { id: otherUser.id, role: "user" };

    const response = await runAssessRoute.POST(
      nextRequest(`http://localhost/api/runs/${run.id}/assess`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: run.id }) },
    );

    expect(response.status).toBe(403);
  });

  it("returns 409 when assessment is requested for a non-completed run", async () => {
    const owner = await createUser("owner@example.com");
    const campaign = await buildCampaign(owner.id);
    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: owner.id,
        name: "Queued Run",
        query: "gaming creators",
        target: 2,
        campaignId: campaign.campaignId,
        status: RunRequestStatus.QUEUED,
      },
    });

    currentSessionUser = { id: owner.id, role: "user" };

    const response = await runAssessRoute.POST(
      nextRequest(`http://localhost/api/runs/${run.id}/assess`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: run.id }) },
    );

    expect(response.status).toBe(409);
  });

  it("returns 400 when the run brief is empty", async () => {
    const owner = await createUser("owner@example.com");
    const { run } = await createCompletedRunWithResults(owner.id, false);

    currentSessionUser = { id: owner.id, role: "user" };

    const response = await runAssessRoute.POST(
      nextRequest(`http://localhost/api/runs/${run.id}/assess`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: run.id }) },
    );

    expect(response.status).toBe(400);
  });

  it("returns 202 and enqueues assessment jobs for a completed run with a brief", async () => {
    const owner = await createUser("owner@example.com");
    const { run } = await createCompletedRunWithResults(owner.id);

    currentSessionUser = { id: owner.id, role: "user" };

    const response = await runAssessRoute.POST(
      nextRequest(`http://localhost/api/runs/${run.id}/assess`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: run.id }) },
    );

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload.enqueued).toBe(2);

    const rows = await prisma.runChannelAssessment.findMany({
      where: {
        runRequestId: run.id,
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === RunChannelAssessmentStatus.QUEUED)).toBe(true);

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'runs.assess.channel-fit'
    `;
    expect(jobs[0]?.count).toBe(2);
  });

  it("returns assessments from GET /api/runs/:id with [] as the default", async () => {
    const owner = await createUser("owner@example.com");
    const { run } = await createCompletedRunWithResults(owner.id);

    currentSessionUser = { id: owner.id, role: "user" };

    const response = await runDetailRoute.GET(
      new Request(`http://localhost/api/runs/${run.id}`),
      { params: Promise.resolve({ id: run.id }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.assessments).toEqual([]);
  });

  it("returns populated assessments from GET /api/runs/:id", async () => {
    const owner = await createUser("owner@example.com");
    const { run, channelA } = await createCompletedRunWithResults(owner.id);

    await prisma.runChannelAssessment.create({
      data: {
        runRequestId: run.id,
        channelId: channelA.id,
        status: RunChannelAssessmentStatus.COMPLETED,
        model: "gpt-4.1-mini",
        fitScore: 0.81,
        fitReasons: ["Strong audience overlap"],
        fitConcerns: ["Limited local-language reach"],
        recommendedAngles: ["Benchmark-style review"],
        avoidTopics: ["Console-only positioning"],
        assessedAt: new Date("2026-04-15T10:00:00.000Z"),
      },
    });

    currentSessionUser = { id: owner.id, role: "user" };

    const response = await runDetailRoute.GET(
      new Request(`http://localhost/api/runs/${run.id}`),
      { params: Promise.resolve({ id: run.id }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.assessments).toHaveLength(1);
    expect(payload.assessments[0]).toMatchObject({
      runRequestId: run.id,
      channelId: channelA.id,
      status: "completed",
      model: "gpt-4.1-mini",
      fitScore: 0.81,
      fitReasons: ["Strong audience overlap"],
    });
  });

  it("returns 400 for empty brief PATCH payloads and 200 for valid updates", async () => {
    const owner = await createUser("owner@example.com");
    const { run } = await createCompletedRunWithResults(owner.id, false);

    currentSessionUser = { id: owner.id, role: "user" };

    const invalidResponse = await runBriefRoute.PATCH(
      nextRequest(`http://localhost/api/runs/${run.id}/brief`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: run.id }) },
    );

    expect(invalidResponse.status).toBe(400);

    const validResponse = await runBriefRoute.PATCH(
      nextRequest(`http://localhost/api/runs/${run.id}/brief`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientIndustry: "Gaming Hardware",
          deliverables: ["Dedicated video", "Short-form cutdown"],
        }),
      }),
      { params: Promise.resolve({ id: run.id }) },
    );

    expect(validResponse.status).toBe(200);
    const payload = await validResponse.json();
    expect(payload.clientIndustry).toBe("Gaming Hardware");
    expect(payload.deliverables).toEqual(["Dedicated video", "Short-form cutdown"]);
  });

  it("creates runs with brief fields persisted from POST /api/runs", async () => {
    const owner = await createUser("owner@example.com");
    await prisma.userProviderCredential.create({
      data: {
        userId: owner.id,
        provider: CredentialProvider.YOUTUBE_DATA_API,
        encryptedSecret: "encrypted",
        encryptionIv: "iv",
        encryptionAuthTag: "tag",
        keyVersion: 1,
      },
    });
    currentSessionUser = { id: owner.id, role: "user" };

    const response = await runsRoute.POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Run 1",
          query: "gaming creators",
          target: 20,
          metadata: {
            ...(await buildCampaign(owner.id)),
            campaignManagerUserId: owner.id,
            clientIndustry: "Gaming Hardware",
            campaignObjective: "Drive awareness for a new GPU launch",
            targetAudienceAge: "18-34",
            targetAudienceGender: "All",
            targetGeographies: ["Germany", "Austria"],
            contentRestrictions: ["No political content"],
            budgetTier: "mid",
            deliverables: ["Dedicated video", "Short-form cutdown"],
          },
        }),
      }),
    );

    expect(response.status).toBe(202);
    const payload = await response.json();

    const run = await prisma.runRequest.findUniqueOrThrow({
      where: {
        id: payload.runId as string,
      },
    });

    expect(run.clientIndustry).toBe("Gaming Hardware");
    expect(run.campaignObjective).toBe("Drive awareness for a new GPU launch");
    expect(run.targetGeographies).toEqual(["Germany", "Austria"]);
    expect(run.deliverables).toEqual(["Dedicated video", "Short-form cutdown"]);
  });
});
