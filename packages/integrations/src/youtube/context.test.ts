import { afterEach, describe, expect, it, vi } from "vitest";

import {
  YoutubeChannelContextProviderError,
  fetchYoutubeChannelContext,
} from "./context";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("fetchYoutubeChannelContext", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps channel metadata and recent uploads into normalized context", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UC-CONTEXT-1",
              snippet: {
                title: "  Channel Name  ",
                description: "  Channel description  ",
                customUrl: "@channel-name",
                publishedAt: "2020-01-01T00:00:00Z",
                thumbnails: {
                  high: { url: "https://img.example.com/channel.jpg" },
                },
              },
              statistics: {
                subscriberCount: "1200",
                viewCount: "45000",
                videoCount: "87",
              },
              contentDetails: {
                relatedPlaylists: {
                  uploads: "UU-CONTEXT-1",
                },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              contentDetails: {
                videoId: "video-1",
              },
              snippet: {
                title: "  Latest video  ",
                description: "  Video description  ",
                publishedAt: "2024-01-10T12:00:00Z",
              },
            },
            {
              contentDetails: {
                videoId: "video-2",
              },
              snippet: {
                title: "Second video",
                publishedAt: "2024-01-09T12:00:00Z",
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const context = await fetchYoutubeChannelContext({
      apiKey: "yt-key",
      channelId: "UC-CONTEXT-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(context).toEqual({
      youtubeChannelId: "UC-CONTEXT-1",
      title: "Channel Name",
      handle: "@channel-name",
      description: "Channel description",
      thumbnailUrl: "https://img.example.com/channel.jpg",
      publishedAt: "2020-01-01T00:00:00Z",
      subscriberCount: 1200,
      viewCount: 45000,
      videoCount: 87,
      recentVideos: [
        {
          youtubeVideoId: "video-1",
          title: "Latest video",
          description: "Video description",
          publishedAt: "2024-01-10T12:00:00Z",
        },
        {
          youtubeVideoId: "video-2",
          title: "Second video",
          description: null,
          publishedAt: "2024-01-09T12:00:00Z",
        },
      ],
    });
  });

  it("returns an empty recent video list when uploads playlist is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UC-CONTEXT-2",
              snippet: {
                title: "Channel Name",
              },
            },
          ],
        }),
      ),
    );

    const context = await fetchYoutubeChannelContext({
      apiKey: "yt-key",
      channelId: "UC-CONTEXT-2",
    });

    expect(context.recentVideos).toEqual([]);
  });

  it("throws quota-specific provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              errors: [{ reason: "quotaExceeded" }],
            },
          },
          403,
        ),
      ),
    );

    await expect(
      fetchYoutubeChannelContext({
        apiKey: "yt-key",
        channelId: "UC-CONTEXT-1",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "YOUTUBE_QUOTA_EXCEEDED",
        status: 429,
        message: "YouTube API quota exceeded",
      } satisfies Partial<YoutubeChannelContextProviderError>),
    );
  });

  it("throws auth-specific provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              errors: [{ reason: "keyInvalid" }],
            },
          },
          400,
        ),
      ),
    );

    await expect(
      fetchYoutubeChannelContext({
        apiKey: "yt-key",
        channelId: "UC-CONTEXT-1",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "YOUTUBE_AUTH_FAILED",
        status: 401,
        message: "YouTube API key is invalid or unauthorized",
      } satisfies Partial<YoutubeChannelContextProviderError>),
    );
  });

  it("throws a generic provider error for other non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ error: { message: "boom" } }, 500)),
    );

    await expect(
      fetchYoutubeChannelContext({
        apiKey: "yt-key",
        channelId: "UC-CONTEXT-1",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "YOUTUBE_CONTEXT_FAILED",
        status: 502,
        message: "YouTube channel context request failed",
      } satisfies Partial<YoutubeChannelContextProviderError>),
    );
  });
});
