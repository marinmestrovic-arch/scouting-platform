import { describe, expect, it } from "vitest";

import {
  createRunRequestSchema,
  runStatusResponseSchema,
  updateRunBriefRequestSchema,
} from "./runs";

const TEST_UUID = "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b";
const TEST_CHANNEL_UUID = "24a57b02-3008-4af1-9b3a-340bd0db7d1c";

describe("run brief contracts", () => {
  it("rejects empty brief update payloads", () => {
    expect(() => updateRunBriefRequestSchema.parse({})).toThrow(
      "At least one brief field must be provided",
    );
  });

  it("accepts a brief update with a single field", () => {
    const payload = updateRunBriefRequestSchema.parse({
      clientIndustry: "tech",
    });

    expect(payload.clientIndustry).toBe("tech");
  });

  it("accepts brief fields during run creation", () => {
    const payload = createRunRequestSchema.parse({
      name: "Campaign run",
      query: "gaming creators",
      target: 20,
      metadata: {
        campaignId: TEST_UUID,
        campaignManagerUserId: TEST_UUID,
        clientIndustry: "Gaming",
        campaignObjective: "Drive awareness for a GPU launch",
        targetAudienceAge: "18-34",
        targetAudienceGender: "All",
        targetGeographies: ["Germany", "Austria"],
        contentRestrictions: ["No political content"],
        budgetTier: "mid",
        deliverables: ["Dedicated video", "Short-form cutdown"],
      },
    });

    expect(payload.metadata.clientIndustry).toBe("Gaming");
    expect(payload.metadata.deliverables).toEqual([
      "Dedicated video",
      "Short-form cutdown",
    ]);
  });

  it("defaults missing run assessments to an empty array", () => {
    const payload = runStatusResponseSchema.parse({
      id: TEST_UUID,
      requestedByUserId: TEST_UUID,
      name: "Campaign run",
      query: "gaming creators",
      target: 20,
      status: "queued",
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      metadata: {
        campaignId: TEST_UUID,
        client: "Sony",
        market: "DACH",
        campaignManagerUserId: TEST_UUID,
        campaignManager: {
          id: TEST_UUID,
          email: "manager@example.com",
          name: "Manager",
        },
        briefLink: null,
        campaignName: "Spring Launch",
        month: "march",
        year: 2026,
        dealOwner: "Marin Mestrovic",
        dealName: "Sony Launch DACH",
        pipeline: "New business",
        dealStage: "Contract sent",
        currency: "EUR",
        dealType: "Paid social",
        activationType: "YouTube integration",
      },
      results: [
        {
          id: TEST_CHANNEL_UUID,
          channelId: TEST_CHANNEL_UUID,
          rank: 1,
          source: "catalog",
          createdAt: new Date().toISOString(),
          channel: {
            id: TEST_CHANNEL_UUID,
            youtubeChannelId: "UC_RUN_RESULT",
            title: "Run Result Channel",
            handle: "@runresult",
            thumbnailUrl: null,
          },
        },
      ],
    });

    expect(payload.assessments).toEqual([]);
  });
});
