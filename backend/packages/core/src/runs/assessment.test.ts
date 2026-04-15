import { RunChannelAssessmentStatus, RunRequestStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  prismaMock,
  enqueueJobMock,
  enrichCampaignFitWithOpenAiMock,
  extractOpenAiCampaignFitFromRawPayloadMock,
  toRunChannelAssessmentItemMock,
  toRunMetadataMock,
} = vi.hoisted(() => {
  const runChannelAssessment = {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  };

  return {
    prismaMock: {
      runRequest: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      runChannelAssessment,
      channelYoutubeContext: {
        findUnique: vi.fn(),
      },
      channelEnrichment: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (tx: typeof prismaMock) => Promise<unknown>) =>
        callback(prismaMock),
      ),
    },
    enqueueJobMock: vi.fn(),
    enrichCampaignFitWithOpenAiMock: vi.fn(),
    extractOpenAiCampaignFitFromRawPayloadMock: vi.fn(),
    toRunChannelAssessmentItemMock: vi.fn((row: { id: string; runRequestId: string; channelId: string; status: string }) => ({
      id: row.id,
      runRequestId: row.runRequestId,
      channelId: row.channelId,
      status:
        row.status === RunChannelAssessmentStatus.COMPLETED
          ? "completed"
          : row.status === RunChannelAssessmentStatus.RUNNING
            ? "running"
            : row.status === RunChannelAssessmentStatus.FAILED
              ? "failed"
              : "queued",
      model: null,
      fitScore: null,
      fitReasons: null,
      fitConcerns: null,
      recommendedAngles: null,
      avoidTopics: null,
      assessedAt: null,
      lastError: null,
      createdAt: new Date("2026-04-15T10:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-15T10:00:00.000Z").toISOString(),
    })),
    toRunMetadataMock: vi.fn((row: unknown) => row),
  };
});

vi.mock("@scouting-platform/db", () => ({
  prisma: prismaMock,
}));

vi.mock("../queue", () => ({
  enqueueJob: enqueueJobMock,
}));

vi.mock("@scouting-platform/integrations", () => ({
  enrichCampaignFitWithOpenAi: enrichCampaignFitWithOpenAiMock,
  extractOpenAiCampaignFitFromRawPayload: extractOpenAiCampaignFitFromRawPayloadMock,
  isOpenAiCampaignFitError: (error: unknown) => {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string" &&
        String((error as { code: string }).code).startsWith("OPENAI_"),
    );
  },
}));

vi.mock("./repository", () => ({
  parseStringArrayOrNull: (value: unknown) => {
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
  },
  runMetadataSelect: {
    campaignId: true,
    client: true,
    market: true,
    campaignManagerUserId: true,
    briefLink: true,
    campaignName: true,
    month: true,
    year: true,
    dealOwner: true,
    dealName: true,
    pipeline: true,
    dealStage: true,
    currency: true,
    dealType: true,
    activationType: true,
    hubspotInfluencerType: true,
    hubspotInfluencerVertical: true,
    hubspotCountryRegion: true,
    hubspotLanguage: true,
    clientIndustry: true,
    campaignObjective: true,
    targetAudienceAge: true,
    targetAudienceGender: true,
    targetGeographies: true,
    contentRestrictions: true,
    budgetTier: true,
    deliverables: true,
    campaignManagerUser: {
      select: {
        id: true,
        email: true,
        name: true,
      },
    },
  },
  toRunChannelAssessmentItem: toRunChannelAssessmentItemMock,
  toRunMetadata: toRunMetadataMock,
}));

import {
  executeRunChannelFitAssessment,
  requestRunAssessment,
  updateRunBrief,
} from "./assessment";

describe("run assessment core service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws RUN_NOT_FOUND when the run is missing", async () => {
    prismaMock.runRequest.findUnique.mockResolvedValueOnce(null);

    await expect(
      requestRunAssessment({
        runId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        role: "user",
      }),
    ).rejects.toMatchObject({
      code: "RUN_NOT_FOUND",
      status: 404,
    });
  });

  it("queues missing assessments and enqueues a job per channel", async () => {
    prismaMock.runRequest.findUnique.mockResolvedValueOnce({
      id: "run-1",
      requestedByUserId: "user-1",
      status: RunRequestStatus.COMPLETED,
      clientIndustry: "Gaming",
      campaignObjective: "Launch awareness",
      targetAudienceAge: null,
      targetAudienceGender: null,
      targetGeographies: null,
      contentRestrictions: null,
      budgetTier: null,
      deliverables: null,
      results: [{ channelId: "channel-1" }, { channelId: "channel-2" }],
    });
    prismaMock.runChannelAssessment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "assessment-1",
          runRequestId: "run-1",
          channelId: "channel-1",
        },
        {
          id: "assessment-2",
          runRequestId: "run-1",
          channelId: "channel-2",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "assessment-1",
          runRequestId: "run-1",
          channelId: "channel-1",
          status: RunChannelAssessmentStatus.QUEUED,
        },
        {
          id: "assessment-2",
          runRequestId: "run-1",
          channelId: "channel-2",
          status: RunChannelAssessmentStatus.QUEUED,
        },
      ]);
    prismaMock.runChannelAssessment.create
      .mockResolvedValueOnce({
        id: "assessment-1",
        runRequestId: "run-1",
        channelId: "channel-1",
      })
      .mockResolvedValueOnce({
        id: "assessment-2",
        runRequestId: "run-1",
        channelId: "channel-2",
      });

    const result = await requestRunAssessment({
      runId: "run-1",
      userId: "user-1",
      role: "user",
    });

    expect(enqueueJobMock).toHaveBeenNthCalledWith(1, "runs.assess.channel-fit", {
      runRequestId: "run-1",
      channelId: "channel-1",
      requestedByUserId: "user-1",
    });
    expect(enqueueJobMock).toHaveBeenNthCalledWith(2, "runs.assess.channel-fit", {
      runRequestId: "run-1",
      channelId: "channel-2",
      requestedByUserId: "user-1",
    });
    expect(result.enqueued).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("persists a completed assessment after a fresh integration call", async () => {
    prismaMock.runChannelAssessment.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.runChannelAssessment.findUnique.mockResolvedValueOnce({
      id: "assessment-1",
      runRequestId: "run-1",
      channelId: "channel-1",
      rawOpenaiPayload: null,
      rawOpenaiPayloadFetchedAt: null,
      runRequest: {
        client: "NVIDIA",
        campaignName: "RTX Launch",
        clientIndustry: "Gaming Hardware",
        campaignObjective: "Drive awareness",
        targetAudienceAge: "18-34",
        targetAudienceGender: "All",
        targetGeographies: ["Germany"],
        contentRestrictions: ["No politics"],
        budgetTier: "mid",
        deliverables: ["Dedicated video"],
      },
      channel: {
        youtubeChannelId: "UC-1",
        title: "Channel",
        handle: "@channel",
        description: "desc",
        thumbnailUrl: null,
        contentLanguage: "en",
      },
    });
    prismaMock.channelYoutubeContext.findUnique.mockResolvedValueOnce({ context: null });
    prismaMock.channelEnrichment.findUnique.mockResolvedValueOnce({
      status: "COMPLETED",
      summary: "Gaming creator",
      topics: ["gaming"],
      brandFitNotes: "Fits gaming hardware",
    });
    enrichCampaignFitWithOpenAiMock.mockResolvedValueOnce({
      profile: {
        fitScore: 0.9,
        fitReasons: ["Strong audience fit"],
        fitConcerns: [],
        recommendedAngles: ["Benchmark breakdown"],
        avoidTopics: ["Console-only framing"],
      },
      rawPayload: { id: "resp-1", usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
      model: "gpt-4.1-mini",
    });
    prismaMock.runChannelAssessment.update.mockResolvedValue({});

    await executeRunChannelFitAssessment({
      runRequestId: "run-1",
      channelId: "channel-1",
      requestedByUserId: "user-1",
    });

    expect(enrichCampaignFitWithOpenAiMock).toHaveBeenCalled();
    expect(prismaMock.runChannelAssessment.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.runChannelAssessment.update.mock.calls[1]?.[0]).toMatchObject({
      data: expect.objectContaining({
        status: RunChannelAssessmentStatus.COMPLETED,
        model: "gpt-4.1-mini",
        fitScore: 0.9,
      }),
    });
  });

  it("updates the run brief and returns mapped metadata", async () => {
    prismaMock.runRequest.findUnique.mockResolvedValueOnce({
      id: "run-1",
      requestedByUserId: "user-1",
    });
    prismaMock.runRequest.update.mockResolvedValueOnce({
      clientIndustry: "Gaming",
    });
    toRunMetadataMock.mockReturnValueOnce({
      clientIndustry: "Gaming",
    });

    const result = await updateRunBrief({
      runId: "run-1",
      userId: "user-1",
      role: "user",
      brief: {
        clientIndustry: "Gaming",
      },
    });

    expect(prismaMock.runRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({
          clientIndustry: "Gaming",
        }),
      }),
    );
    expect(result).toEqual({
      clientIndustry: "Gaming",
    });
  });
});
