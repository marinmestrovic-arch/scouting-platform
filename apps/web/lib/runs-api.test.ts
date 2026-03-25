import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, createRun, fetchRecentRuns, fetchRunStatus } from "./runs-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function buildRunStatusPayload() {
  return {
    id: "53adac17-f39d-4731-a61f-194150fbc431",
    requestedByUserId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
    name: "Gaming Run",
    query: "gaming creators",
    target: 20,
    status: "running",
    lastError: null,
    createdAt: "2026-03-10T10:00:00.000Z",
    updatedAt: "2026-03-10T10:02:00.000Z",
    startedAt: "2026-03-10T10:01:00.000Z",
    completedAt: null,
    metadata: buildRunMetadata(),
    results: [
      {
        id: "24a57b02-3008-4af1-9b3a-340bd0db7d1c",
        channelId: "24a57b02-3008-4af1-9b3a-340bd0db7d1c",
        rank: 1,
        source: "catalog",
        createdAt: "2026-03-10T10:02:00.000Z",
        channel: {
          id: "24a57b02-3008-4af1-9b3a-340bd0db7d1c",
          youtubeChannelId: "UC_RUN_RESULT",
          title: "Run Result Channel",
          handle: "@runresult",
          thumbnailUrl: "https://example.com/thumb.jpg",
        },
      },
    ],
  };
}

function buildRunMetadata() {
  return {
    client: "Sony",
    market: "DACH",
    campaignManagerUserId: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
    campaignManager: {
      id: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
      email: "manager@example.com",
      name: "Manager",
    },
    briefLink: "https://example.com/brief",
    campaignName: "Spring Launch 2026",
    month: "march" as const,
    year: 2026,
    dealOwner: "Marin",
    dealName: "Sony Gaming Q2",
    pipeline: "New business",
    dealStage: "Contract sent",
    currency: "EUR",
    dealType: "Paid social",
    activationType: "YouTube integration",
  };
}

function buildRecentRunsPayload() {
  return {
    items: [
      {
        id: "53adac17-f39d-4731-a61f-194150fbc431",
        name: "Gaming Run",
        query: "gaming creators",
        target: 20,
        status: "running",
        lastError: null,
        createdAt: "2026-03-10T10:00:00.000Z",
        updatedAt: "2026-03-10T10:02:00.000Z",
        startedAt: "2026-03-10T10:01:00.000Z",
        completedAt: null,
        resultCount: 2,
        metadata: buildRunMetadata(),
      },
    ],
    filterOptions: {
      campaignManagers: [buildRunMetadata().campaignManager],
      clients: ["Sony"],
      markets: ["DACH"],
    },
  };
}

describe("runs api helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a run via POST /api/runs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        runId: "53adac17-f39d-4731-a61f-194150fbc431",
        status: "queued",
      }),
    );

    const response = await createRun({
      name: "  Gaming Run  ",
      query: "  gaming creators  ",
      target: 20,
      metadata: {
        client: "Sony",
        market: "DACH",
        campaignManagerUserId: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
        briefLink: "https://example.com/brief",
        campaignName: "Spring Launch 2026",
        month: "march",
        year: 2026,
        dealOwner: "Marin",
        dealName: "Sony Gaming Q2",
        pipeline: "New business",
        dealStage: "Contract sent",
        currency: "EUR",
        dealType: "Paid social",
        activationType: "YouTube integration",
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Gaming Run",
          query: "gaming creators",
          target: 20,
          metadata: {
            client: "Sony",
            market: "DACH",
            campaignManagerUserId: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
            briefLink: "https://example.com/brief",
            campaignName: "Spring Launch 2026",
            month: "march",
            year: 2026,
            dealOwner: "Marin",
            dealName: "Sony Gaming Q2",
            pipeline: "New business",
            dealStage: "Contract sent",
            currency: "EUR",
            dealType: "Paid social",
            activationType: "YouTube integration",
          },
        }),
      }),
    );
    expect(response).toEqual({
      runId: "53adac17-f39d-4731-a61f-194150fbc431",
      status: "queued",
    });
  });

  it("surfaces run creation API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Assigned YouTube API key is required before creating a run",
        },
        400,
      ),
    );

    await expect(
      createRun({
        name: "Gaming Run",
        query: "gaming creators",
        target: 20,
        metadata: {
          client: "Sony",
          market: "DACH",
          campaignManagerUserId: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
          briefLink: "https://example.com/brief",
          campaignName: "Spring Launch 2026",
          month: "march",
          year: 2026,
          dealOwner: "Marin",
          dealName: "Sony Gaming Q2",
          pipeline: "New business",
          dealStage: "Contract sent",
          currency: "EUR",
          dealType: "Paid social",
          activationType: "YouTube integration",
        },
      }),
    ).rejects.toMatchObject({
      message: "Assigned YouTube API key is required before creating a run",
      status: 400,
    } satisfies Partial<ApiRequestError>);
  });

  it("throws validation errors for invalid run input", async () => {
    await expect(
      createRun({
        name: "",
        query: "gaming creators",
        target: 20,
        metadata: {
          client: "Sony",
          market: "DACH",
          campaignManagerUserId: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
          briefLink: "https://example.com/brief",
          campaignName: "Spring Launch 2026",
          month: "march",
          year: 2026,
          dealOwner: "Marin",
          dealName: "Sony Gaming Q2",
          pipeline: "New business",
          dealStage: "Contract sent",
          currency: "EUR",
          dealType: "Paid social",
          activationType: "YouTube integration",
        },
      }),
    ).rejects.toThrow("Too small: expected string to have >=1 characters");
  });

  it("throws validation errors for invalid run target", async () => {
    await expect(
      createRun({
        name: "Gaming Run",
        query: "gaming creators",
        target: 0,
        metadata: {
          client: "Sony",
          market: "DACH",
          campaignManagerUserId: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
          briefLink: "https://example.com/brief",
          campaignName: "Spring Launch 2026",
          month: "march",
          year: 2026,
          dealOwner: "Marin",
          dealName: "Sony Gaming Q2",
          pipeline: "New business",
          dealStage: "Contract sent",
          currency: "EUR",
          dealType: "Paid social",
          activationType: "YouTube integration",
        },
      }),
    ).rejects.toThrow("Too small");
  });

  it("loads run detail data from GET /api/runs/:id", async () => {
    const abortController = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildRunStatusPayload()),
    );

    const response = await fetchRunStatus(
      "53adac17-f39d-4731-a61f-194150fbc431",
      abortController.signal,
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/runs/53adac17-f39d-4731-a61f-194150fbc431",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        signal: abortController.signal,
      }),
    );
    expect(response.results[0]?.channel.title).toBe("Run Result Channel");
  });

  it("loads recent runs data from GET /api/runs", async () => {
    const abortController = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildRecentRunsPayload()),
    );

    const response = await fetchRecentRuns({ signal: abortController.signal });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        signal: abortController.signal,
      }),
    );
    expect(response.items[0]?.resultCount).toBe(2);
  });

  it("maps missing run responses to a friendly not-found error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 404));

    await expect(fetchRunStatus("53adac17-f39d-4731-a61f-194150fbc431")).rejects.toMatchObject({
      message: "Run not found.",
      status: 404,
    } satisfies Partial<ApiRequestError>);
  });

  it("maps recent runs authorization failures to a friendly error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(fetchRecentRuns()).rejects.toMatchObject({
      message: "You are not authorized to view recent runs.",
      status: 403,
    } satisfies Partial<ApiRequestError>);
  });
});
