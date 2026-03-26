import { describe, expect, it } from "vitest";

import {
  createRunRequestSchema,
  createAdminUserRequestSchema,
  listRecentRunsResponseSchema,
  listChannelsQuerySchema,
  runStatusResponseSchema,
  segmentFiltersSchema,
} from "./index";

function buildRunMetadataInput() {
  return {
    campaignId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
    campaignManagerUserId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
  };
}

function buildRunMetadataResponse() {
  return {
    campaignId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
    client: "Sony",
    market: "DACH",
    campaignManagerUserId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
    campaignName: "Spring Launch",
    month: "march" as const,
    year: 2026,
    dealOwner: "Marin Mestrovic",
    dealName: "Sony Launch DACH",
    pipeline: "New business",
    dealStage: "Contract sent",
    currency: "EUR",
    dealType: "Paid social",
    activationType: "YouTube integration",
    briefLink: null,
    campaignManager: {
      id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
      email: "manager@example.com",
      name: "Manager",
    },
  };
}

describe("week 1 and week 2 contracts", () => {
  it("parses valid admin user payload", () => {
    const payload = createAdminUserRequestSchema.parse({
      email: "user@example.com",
      role: "user",
      password: "StrongPassword123",
    });

    expect(payload.email).toBe("user@example.com");
  });

  it("normalizes channel query defaults", () => {
    const payload = listChannelsQuerySchema.parse({});

    expect(payload.page).toBe(1);
    expect(payload.pageSize).toBe(20);
  });

  it("accepts channel filters with repeated status arrays", () => {
    const payload = listChannelsQuerySchema.parse({
      query: "space",
      enrichmentStatus: ["completed", "failed"],
      advancedReportStatus: ["pending_approval", "stale"],
    });

    expect(payload.query).toBe("space");
    expect(payload.enrichmentStatus).toEqual(["completed", "failed"]);
    expect(payload.advancedReportStatus).toEqual(["pending_approval", "stale"]);
  });

  it("rejects invalid channel filter statuses", () => {
    const parsed = listChannelsQuerySchema.safeParse({
      enrichmentStatus: ["not-a-status"],
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts object-based segment filters", () => {
    const payload = segmentFiltersSchema.parse({
      minSubscribers: 10000,
      locale: "en",
    });

    expect(payload.minSubscribers).toBe(10000);
  });

  it("rejects segment channel id membership lists in this phase", () => {
    const parsed = segmentFiltersSchema.safeParse({
      channelIds: ["abc123"],
    });

    expect(parsed.success).toBe(false);
  });
  it("parses valid run creation payload", () => {
    const payload = createRunRequestSchema.parse({
      name: "Campaign run",
      query: "gaming creators",
      target: 20,
      metadata: buildRunMetadataInput(),
    });

    expect(payload.name).toBe("Campaign run");
    expect(payload.target).toBe(20);
  });

  it("parses run status response shape", () => {
    const payload = runStatusResponseSchema.parse({
      id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
      requestedByUserId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
      name: "Campaign run",
      query: "gaming creators",
      target: 20,
      status: "queued",
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      metadata: buildRunMetadataResponse(),
      results: [
        {
          id: "24a57b02-3008-4af1-9b3a-340bd0db7d1c",
          channelId: "24a57b02-3008-4af1-9b3a-340bd0db7d1c",
          rank: 1,
          source: "catalog",
          createdAt: new Date().toISOString(),
          channel: {
            id: "24a57b02-3008-4af1-9b3a-340bd0db7d1c",
            youtubeChannelId: "UC_RUN_RESULT",
            title: "Run Result Channel",
            handle: "@runresult",
            thumbnailUrl: null,
          },
        },
      ],
    });

    expect(payload.status).toBe("queued");
  });

  it("parses recent runs response shape", () => {
    const payload = listRecentRunsResponseSchema.parse({
      items: [
        {
          id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
          name: "Campaign run",
          query: "gaming creators",
          target: 20,
          status: "completed",
          lastError: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          resultCount: 3,
          metadata: buildRunMetadataResponse(),
        },
      ],
      filterOptions: {
        campaignManagers: [
          {
            id: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
            email: "manager@example.com",
            name: "Manager",
          },
        ],
        clients: ["Sony"],
        markets: ["DACH"],
      },
    });

    expect(payload.items[0]?.resultCount).toBe(3);
  });
});
