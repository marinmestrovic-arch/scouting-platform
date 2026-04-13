import { describe, expect, it } from "vitest";

import {
  adminDashboardResponseSchema,
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
        structuredProfile: {
          metadata: {
            language: "en",
            contentFormats: ["long_form"],
            sponsorSignals: [],
            geoHints: ["US"],
            uploadCadenceHint: "weekly",
          },
          niche: {
            primary: "gaming",
            secondary: ["commentary"],
            confidence: 0.83,
          },
          brandSafety: {
            status: "safe",
            flags: [],
            rationale: "No visible safety concerns in the provided metadata.",
            confidence: 0.76,
          },
        },
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
    expect(payload.enrichment.structuredProfile?.niche.primary).toBe("gaming");
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

  it("parses admin dashboard summary payload", () => {
    const payload = adminDashboardResponseSchema.parse({
      generatedAt: new Date().toISOString(),
      approvals: {
        counts: {
          pendingApproval: 3,
          approved: 1,
          queued: 1,
          running: 0,
          failed: 2,
        },
        pendingPreview: [
          {
            id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
            channel: {
              id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
              youtubeChannelId: "UC-WEEK5-DASH-1",
              title: "Queue Channel",
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
            lastCompletedReport: null,
          },
        ],
      },
      imports: {
        counts: {
          queued: 1,
          running: 1,
          failed: 2,
        },
        attentionPreview: [
          {
            id: "4ba0de9b-52c6-4ff9-b86e-52cfc2dc71ec",
            fileName: "contacts.csv",
            templateVersion: "v1",
            status: "failed",
            totalRowCount: 12,
            importedRowCount: 10,
            failedRowCount: 2,
            lastError: "Batch failed",
            requestedBy: {
              id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
              email: "admin@example.com",
              name: "Admin",
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            completedAt: null,
          },
        ],
      },
      users: {
        totalCount: 12,
        activeCount: 11,
        adminCount: 2,
        missingYoutubeKeyCount: 4,
        missingYoutubeKeyPreview: [
          {
            id: "b19c5329-9872-45d4-b552-1dc4f2cb9cbf",
            email: "manager-without-key@example.com",
            name: "Missing Key",
            role: "user",
            userType: "campaign_manager",
            isActive: true,
            youtubeKeyAssigned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });

    expect(payload.approvals.counts.pendingApproval).toBe(3);
    expect(payload.imports.attentionPreview[0]?.status).toBe("failed");
    expect(payload.users.missingYoutubeKeyPreview[0]?.youtubeKeyAssigned).toBe(false);
  });

  it("rejects malformed admin dashboard preview items and counts", () => {
    const malformed = adminDashboardResponseSchema.safeParse({
      generatedAt: new Date().toISOString(),
      approvals: {
        counts: {
          pendingApproval: -1,
          approved: 0,
          queued: 0,
          running: 0,
          failed: 0,
        },
        pendingPreview: [
          {
            id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
            channel: {
              id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
              youtubeChannelId: "UC-WEEK5-DASH-1",
              title: "Queue Channel",
            },
            requestedBy: {
              id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
              email: "manager@example.com",
              name: "Manager",
            },
            reviewedBy: null,
            status: "stale",
            decisionNote: null,
            lastError: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            reviewedAt: null,
            startedAt: null,
            completedAt: null,
            lastCompletedReport: null,
          },
        ],
      },
      imports: {
        counts: {
          queued: 0,
          running: 0,
          failed: 0,
        },
        attentionPreview: [],
      },
      users: {
        totalCount: 0,
        activeCount: 0,
        adminCount: 0,
        missingYoutubeKeyCount: 0,
        missingYoutubeKeyPreview: [],
      },
    });

    expect(malformed.success).toBe(false);
  });
});
