import { describe, expect, it } from "vitest";

import {
  adminAdvancedReportRequestDetailSchema,
  channelDetailSchema,
  requestAdvancedReportResponseSchema,
} from "./index";

describe("week 5 contracts", () => {
  it("parses channel detail with advanced report state and insights", () => {
    const payload = channelDetailSchema.parse({
      id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
      youtubeChannelId: "UC-WEEK5-1",
      title: "Channel Name",
      handle: "@channel-name",
      description: "Channel description",
      thumbnailUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      enrichment: {
        status: "missing",
        updatedAt: null,
        completedAt: null,
        lastError: null,
        summary: null,
        topics: null,
        brandFitNotes: null,
        confidence: null,
      },
      advancedReport: {
        requestId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
        status: "completed",
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        lastError: null,
        requestedAt: new Date().toISOString(),
        reviewedAt: new Date().toISOString(),
        decisionNote: "Approved for paid lookup.",
        lastCompletedReport: {
          requestId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
          completedAt: new Date().toISOString(),
          ageDays: 12,
          withinFreshWindow: true,
        },
      },
      insights: {
        audienceCountries: [
          {
            countryCode: "US",
            countryName: "United States",
            percentage: 32.5,
          },
        ],
        audienceGenderAge: [
          {
            gender: "female",
            ageRange: "18-24",
            percentage: 18.4,
          },
        ],
        audienceInterests: [
          {
            label: "Gaming",
            score: 0.88,
          },
        ],
        estimatedPrice: {
          currencyCode: "USD",
          min: 500,
          max: 900,
        },
        brandMentions: [
          {
            brandName: "Nike",
          },
        ],
      },
    });

    expect(payload.advancedReport.status).toBe("completed");
    expect(payload.insights.brandMentions[0]?.brandName).toBe("Nike");
  });

  it("parses request response shape", () => {
    const payload = requestAdvancedReportResponseSchema.parse({
      channelId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
      advancedReport: {
        requestId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
        status: "pending_approval",
        updatedAt: new Date().toISOString(),
        completedAt: null,
        lastError: null,
        requestedAt: new Date().toISOString(),
        reviewedAt: null,
        decisionNote: null,
        lastCompletedReport: {
          requestId: "f357c9a3-c3ff-46ad-b28a-c515d73bbadc",
          completedAt: new Date().toISOString(),
          ageDays: 3,
          withinFreshWindow: true,
        },
      },
    });

    expect(payload.advancedReport.status).toBe("pending_approval");
  });

  it("parses admin advanced report detail with raw payload", () => {
    const payload = adminAdvancedReportRequestDetailSchema.parse({
      id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
      channel: {
        id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
        youtubeChannelId: "UC-WEEK5-1",
        title: "Channel Name",
      },
      requestedBy: {
        id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
        email: "manager@example.com",
        name: "Manager",
      },
      reviewedBy: null,
      status: "pending_approval",
      decisionNote: null,
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reviewedAt: null,
      startedAt: null,
      completedAt: null,
      lastCompletedReport: {
        requestId: "f357c9a3-c3ff-46ad-b28a-c515d73bbadc",
        completedAt: new Date().toISOString(),
        ageDays: 3,
        withinFreshWindow: true,
      },
      insights: {
        audienceCountries: [],
        audienceGenderAge: [],
        audienceInterests: [],
        estimatedPrice: null,
        brandMentions: [],
      },
      rawPayload: {
        report: {
          report_state: "finished",
        },
      },
    });

    expect(payload.rawPayload).toEqual({
      report: {
        report_state: "finished",
      },
    });
  });
});
