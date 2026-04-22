import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiRequestError,
  fetchChannelDetail,
  fetchChannels,
  requestChannelAdvancedReport,
  requestChannelEnrichment,
  requestChannelEnrichmentBatch,
} from "./channels-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function getFetchRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function buildChannelDetailPayload() {
  return {
    id: "53adac17-f39d-4731-a61f-194150fbc431",
    youtubeChannelId: "UC123",
    title: "Channel One",
    handle: "@channelone",
    description: "Space and creator economy coverage.",
    thumbnailUrl: "https://example.com/thumb.jpg",
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-08T10:00:00.000Z",
    enrichment: {
      status: "completed",
      updatedAt: "2026-03-08T10:00:00.000Z",
      completedAt: "2026-03-08T10:00:00.000Z",
      lastError: null,
      summary: "Creator focused on launches and industry analysis.",
      topics: ["space", "launches"],
      brandFitNotes: "Strong fit for launch providers.",
      confidence: 0.82,
      structuredProfile: null,
    },
    advancedReport: {
      requestId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
      status: "completed",
      updatedAt: "2026-03-08T10:00:00.000Z",
      completedAt: "2026-03-08T10:00:00.000Z",
      lastError: null,
      requestedAt: "2026-03-07T08:00:00.000Z",
      reviewedAt: "2026-03-07T09:00:00.000Z",
      decisionNote: "Approved.",
      lastCompletedReport: {
        requestId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
        completedAt: "2026-03-08T10:00:00.000Z",
        ageDays: 2,
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
          percentage: 21.4,
        },
      ],
      audienceInterests: [
        {
          label: "Space tech",
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
          brandName: "SpaceX",
        },
      ],
    },
  };
}

describe("channels api helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a paginated channel list from GET /api/channels", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "53adac17-f39d-4731-a61f-194150fbc431",
            youtubeChannelId: "UC123",
            title: "Channel One",
            handle: "@channelone",
            thumbnailUrl: "https://example.com/thumb.jpg",
            enrichment: {
              status: "completed",
              updatedAt: "2026-03-08T10:00:00.000Z",
              completedAt: "2026-03-08T10:00:00.000Z",
              lastError: null,
            },
            advancedReport: {
              requestId: null,
              status: "missing",
              updatedAt: null,
              completedAt: null,
              lastError: null,
            },
          },
        ],
        total: 32,
        page: 2,
        pageSize: 10,
      }),
    );

    const response = await fetchChannels({
      page: 2,
      pageSize: 10,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/channels?page=2&pageSize=10",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        total: 32,
        page: 2,
        pageSize: 10,
      }),
    );
  });

  it("serializes repeated status filter params", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      }),
    );

    await fetchChannels({
      page: 1,
      pageSize: 20,
      query: "space",
      enrichmentStatus: ["completed", "failed"],
      advancedReportStatus: ["pending_approval", "stale"],
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/channels?page=1&pageSize=20&query=space&enrichmentStatus=completed&enrichmentStatus=failed&advancedReportStatus=pending_approval&advancedReportStatus=stale",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("serializes creator profile filters and YouTube metric ranges", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      }),
    );

    await fetchChannels({
      page: 1,
      pageSize: 20,
      query: "space",
      countryRegion: ["Croatia", "Germany"],
      influencerVertical: ["Gaming"],
      influencerType: ["Creator"],
      youtubeVideoMedianViewsMin: 100000,
      youtubeVideoMedianViewsMax: 200000,
      youtubeShortsMedianViewsMin: 50000,
      youtubeShortsMedianViewsMax: 150000,
      youtubeFollowersMin: 10000,
      youtubeFollowersMax: 500000,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/channels?page=1&pageSize=20&query=space&countryRegion=Croatia&countryRegion=Germany&influencerVertical=Gaming&influencerType=Creator&youtubeVideoMedianViewsMin=100000&youtubeVideoMedianViewsMax=200000&youtubeShortsMedianViewsMin=50000&youtubeShortsMedianViewsMax=150000&youtubeFollowersMin=10000&youtubeFollowersMax=500000",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("passes an abort signal through to fetch", async () => {
    const abortController = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      }),
    );

    await fetchChannels(
      {
        page: 1,
        pageSize: 20,
      },
      abortController.signal,
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/channels?page=1&pageSize=20",
      expect.objectContaining({
        signal: abortController.signal,
      }),
    );
  });

  it("throws validation errors for invalid request input", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Invalid query parameters",
        },
        400,
      ),
    );

    await expect(
      fetchChannels({
        page: 0,
        pageSize: 20,
      }),
    ).rejects.toThrow("Too small: expected number to be >=1");
  });

  it("throws authorization errors for forbidden responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(
      fetchChannels({
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow("You are not authorized to view the catalog.");
  });

  it("surfaces API error messages for actionable UI feedback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Catalog temporarily unavailable.",
        },
        503,
      ),
    );

    await expect(
      fetchChannels({
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow("Catalog temporarily unavailable.");
  });

  it("throws when the response shape is invalid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: "invalid",
      }),
    );

    await expect(
      fetchChannels({
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow("Received an invalid response from the server.");
  });

  it("loads a channel detail payload from GET /api/channels/:id", async () => {
    const channelId = "53adac17-f39d-4731-a61f-194150fbc431";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildChannelDetailPayload()),
    );

    const response = await fetchChannelDetail(channelId);

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/channels/${channelId}`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        id: channelId,
        youtubeChannelId: "UC123",
      }),
    );
    expect(response.enrichment.topics).toEqual(["space", "launches"]);
  });

  it("requests enrichment from POST /api/channels/:id/enrich", async () => {
    const channelId = "53adac17-f39d-4731-a61f-194150fbc431";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        channelId,
        enrichment: buildChannelDetailPayload().enrichment,
      }),
    );

    const response = await requestChannelEnrichment(channelId);

    expect(fetchSpy).toHaveBeenCalledWith(`/api/channels/${channelId}/enrich`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });
    expect(response.channelId).toBe(channelId);
    expect(response.enrichment.summary).toBe("Creator focused on launches and industry analysis.");
  });

  it("requests an advanced report from POST /api/channels/:id/advanced-report-requests", async () => {
    const channelId = "53adac17-f39d-4731-a61f-194150fbc431";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        channelId,
        advancedReport: {
          ...buildChannelDetailPayload().advancedReport,
          status: "pending_approval",
          updatedAt: "2026-03-09T10:00:00.000Z",
          completedAt: null,
          requestedAt: "2026-03-09T10:00:00.000Z",
          reviewedAt: null,
          decisionNote: null,
          lastError: null,
        },
      }),
    );

    const response = await requestChannelAdvancedReport(channelId);

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/channels/${channelId}/advanced-report-requests`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      },
    );
    expect(response.channelId).toBe(channelId);
    expect(response.advancedReport.status).toBe("pending_approval");
    expect(response.advancedReport.lastCompletedReport).toEqual(
      buildChannelDetailPayload().advancedReport.lastCompletedReport,
    );
  });

  it("aggregates batch enrichment requests without aborting on individual failures", async () => {
    const firstChannelId = "53adac17-f39d-4731-a61f-194150fbc431";
    const secondChannelId = "c539c987-dc34-4ef7-9843-b5dba7320e19";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          channelId: firstChannelId,
          enrichment: buildChannelDetailPayload().enrichment,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 404));

    const response = await requestChannelEnrichmentBatch([firstChannelId, secondChannelId]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenNthCalledWith(1, `/api/channels/${firstChannelId}/enrich`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(2, `/api/channels/${secondChannelId}/enrich`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });
    expect(response[0]).toEqual({
      channelId: firstChannelId,
      ok: true,
      enrichment: buildChannelDetailPayload().enrichment,
    });
    expect(response[1]).toMatchObject({
      channelId: secondChannelId,
      ok: false,
      error: {
        message: "Channel not found.",
      },
    });
  });

  it("caps concurrent batch enrichment requests", async () => {
    const channelIds = ["channel-1", "channel-2", "channel-3", "channel-4", "channel-5", "channel-6"];
    const pendingResponses: Array<{
      channelId: string;
      resolve: (response: Response) => void;
    }> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const requestUrl = getFetchRequestUrl(input);
      const channelId = requestUrl.split("/").at(-2) ?? "unknown-channel";

      return new Promise<Response>((resolve) => {
        pendingResponses.push({
          channelId,
          resolve,
        });
      });
    });

    const responsePromise = requestChannelEnrichmentBatch(channelIds);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(pendingResponses).toHaveLength(4);

    const firstPending = pendingResponses.shift();

    if (!firstPending) {
      throw new Error("Expected first pending enrichment request");
    }

    firstPending.resolve(
      jsonResponse({
        channelId: firstPending.channelId,
        enrichment: buildChannelDetailPayload().enrichment,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(5);

    while (pendingResponses.length > 0) {
      const pending = pendingResponses.shift();

      if (!pending) {
        continue;
      }

      pending.resolve(
        jsonResponse({
          channelId: pending.channelId,
          enrichment: buildChannelDetailPayload().enrichment,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const response = await responsePromise;

    expect(response).toHaveLength(6);
  });

  it("surfaces actionable enrichment request errors from the API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Assigned YouTube API key is required before requesting enrichment",
        },
        400,
      ),
    );

    await expect(
      requestChannelEnrichment("53adac17-f39d-4731-a61f-194150fbc431"),
    ).rejects.toMatchObject({
      message: "Assigned YouTube API key is required before requesting enrichment",
      status: 400,
    } satisfies Partial<ApiRequestError>);
  });

  it("surfaces actionable advanced report request errors from the API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Advanced report request already exists for this channel",
        },
        409,
      ),
    );

    await expect(
      requestChannelAdvancedReport("53adac17-f39d-4731-a61f-194150fbc431"),
    ).rejects.toMatchObject({
      message: "Advanced report request already exists for this channel",
      status: 409,
    } satisfies Partial<ApiRequestError>);
  });

  it("throws when the enrichment response shape is invalid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        channelId: "53adac17-f39d-4731-a61f-194150fbc431",
        enrichment: {
          status: "queued",
        },
      }),
    );

    await expect(
      requestChannelEnrichment("53adac17-f39d-4731-a61f-194150fbc431"),
    ).rejects.toThrow("Received an invalid channel enrichment response from the server.");
  });

  it("throws when the advanced report response shape is invalid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        channelId: "53adac17-f39d-4731-a61f-194150fbc431",
        advancedReport: {
          status: "pending_approval",
        },
      }),
    );

    await expect(
      requestChannelAdvancedReport("53adac17-f39d-4731-a61f-194150fbc431"),
    ).rejects.toThrow("Received an invalid channel advanced report response from the server.");
  });

  it("surfaces not found responses for the detail page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 404));

    await expect(
      fetchChannelDetail("53adac17-f39d-4731-a61f-194150fbc431"),
    ).rejects.toMatchObject({
      message: "Channel not found.",
      status: 404,
    } satisfies Partial<ApiRequestError>);
  });

  it("throws when the detail response shape is invalid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: "53adac17-f39d-4731-a61f-194150fbc431",
        title: "Incomplete",
      }),
    );

    await expect(
      fetchChannelDetail("53adac17-f39d-4731-a61f-194150fbc431"),
    ).rejects.toThrow("Received an invalid channel detail response from the server.");
  });
});
