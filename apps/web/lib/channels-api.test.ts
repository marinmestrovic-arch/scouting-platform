import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchChannels } from "./channels-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
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
});
