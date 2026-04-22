import { afterEach, describe, expect, it, vi } from "vitest";

import {
  YoutubeChannelContextProviderError,
  fetchYoutubeChannelPageEmailSignal,
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
                defaultLanguage: "en-US",
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
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "video-1",
              contentDetails: {
                duration: "PT2M",
              },
              snippet: {
                categoryId: "20",
                tags: [" gaming ", "commentary"],
              },
              statistics: {
                viewCount: "100",
                likeCount: "10",
                commentCount: "5",
              },
            },
            {
              id: "video-2",
              contentDetails: {
                duration: "PT15M",
              },
              snippet: {
                categoryId: "24",
                tags: ["analysis"],
              },
              statistics: {
                viewCount: "200",
                likeCount: "20",
                commentCount: "10",
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

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(context).toEqual({
      youtubeChannelId: "UC-CONTEXT-1",
      title: "Channel Name",
      handle: "@channel-name",
      description: "Channel description",
      thumbnailUrl: "https://img.example.com/channel.jpg",
      publishedAt: "2020-01-01T00:00:00Z",
      defaultLanguage: "en-US",
      subscriberCount: 1200,
      viewCount: 45000,
      videoCount: 87,
      recentVideos: [
        {
          youtubeVideoId: "video-1",
          title: "Latest video",
          description: "Video description",
          publishedAt: "2024-01-10T12:00:00Z",
          durationSeconds: 120,
          isShort: true,
          viewCount: 100,
          likeCount: 10,
          commentCount: 5,
          categoryId: "20",
          categoryName: "Gaming",
          tags: ["gaming", "commentary"],
        },
        {
          youtubeVideoId: "video-2",
          title: "Second video",
          description: null,
          publishedAt: "2024-01-09T12:00:00Z",
          durationSeconds: 900,
          isShort: false,
          viewCount: 200,
          likeCount: 20,
          commentCount: 10,
          categoryId: "24",
          categoryName: "Entertainment",
          tags: ["analysis"],
        },
      ],
      diagnostics: {
        warnings: [],
      },
    });
  });

  it("leaves categoryName null for unmapped YouTube category ids", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UC-CONTEXT-UNMAPPED",
              snippet: {
                title: "Channel Name",
              },
              contentDetails: {
                relatedPlaylists: {
                  uploads: "UU-CONTEXT-UNMAPPED",
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
                title: "Latest video",
                publishedAt: "2024-01-10T12:00:00Z",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "video-1",
              contentDetails: {
                duration: "PT4M",
              },
              snippet: {
                categoryId: "29",
              },
              statistics: {
                viewCount: "100",
                likeCount: "10",
                commentCount: "5",
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const context = await fetchYoutubeChannelContext({
      apiKey: "yt-key",
      channelId: "UC-CONTEXT-UNMAPPED",
    });

    expect(context.recentVideos[0]).toMatchObject({
      categoryId: "29",
      categoryName: null,
    });
  });

  it("continues paging uploads until it inspects enough videos to find 12 long-form uploads", async () => {
    const firstPageItems = Array.from({ length: 25 }, (_, index) => ({
      contentDetails: {
        videoId: `video-${index + 1}`,
      },
      snippet: {
        title: `Video ${index + 1}`,
        publishedAt: `2024-01-${String((index % 9) + 1).padStart(2, "0")}T12:00:00Z`,
      },
    }));
    const secondPageItems = Array.from({ length: 25 }, (_, index) => ({
      contentDetails: {
        videoId: `video-${index + 26}`,
      },
      snippet: {
        title: `Video ${index + 26}`,
        publishedAt: `2024-02-${String((index % 9) + 1).padStart(2, "0")}T12:00:00Z`,
      },
    }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UC-CONTEXT-PAGED",
              snippet: {
                title: "Channel Name",
              },
              contentDetails: {
                relatedPlaylists: {
                  uploads: "UU-CONTEXT-PAGED",
                },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          nextPageToken: "page-2",
          items: firstPageItems,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: Array.from({ length: 25 }, (_, index) => ({
            id: `video-${index + 1}`,
            contentDetails: {
              duration: index < 10 ? "PT15M" : "PT59S",
            },
            snippet: {
              categoryId: "20",
              tags: ["batch-one"],
            },
            statistics: {
              viewCount: String(100 + index),
              likeCount: String(10 + index),
              commentCount: String(1 + index),
            },
          })),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: secondPageItems,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: Array.from({ length: 25 }, (_, index) => ({
            id: `video-${index + 26}`,
            contentDetails: {
              duration: index < 2 ? "PT20M" : "PT45S",
            },
            snippet: {
              categoryId: "24",
              tags: ["batch-two"],
            },
            statistics: {
              viewCount: String(200 + index),
              likeCount: String(20 + index),
              commentCount: String(2 + index),
            },
          })),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const context = await fetchYoutubeChannelContext({
      apiKey: "yt-key",
      channelId: "UC-CONTEXT-PAGED",
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(context.recentVideos).toHaveLength(50);
    expect(context.recentVideos.filter((video) => video.isShort === false)).toHaveLength(12);
    expect(context.recentVideos[0]).toMatchObject({
      durationSeconds: 900,
      isShort: false,
      categoryId: "20",
      categoryName: "Gaming",
      tags: ["batch-one"],
    });
    expect(context.recentVideos[49]).toMatchObject({
      durationSeconds: 45,
      isShort: true,
      categoryId: "24",
      categoryName: "Entertainment",
      tags: ["batch-two"],
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
    expect(context.diagnostics.warnings).toEqual([]);
  });

  it("returns an empty recent video list when the uploads response omits items", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UC-CONTEXT-3",
              snippet: {
                title: "Channel Name",
              },
              contentDetails: {
                relatedPlaylists: {
                  uploads: "UU-CONTEXT-3",
                },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ pageInfo: { totalResults: 0, resultsPerPage: 10 } }));
    vi.stubGlobal("fetch", fetchMock);

    const context = await fetchYoutubeChannelContext({
      apiKey: "yt-key",
      channelId: "UC-CONTEXT-3",
    });

    expect(context.recentVideos).toEqual([]);
    expect(context.diagnostics.warnings).toEqual([]);
  });

  it("keeps recent video statistics best-effort and records diagnostics when the stats request fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UC-CONTEXT-6",
              snippet: {
                title: "Channel Name",
              },
              contentDetails: {
                relatedPlaylists: {
                  uploads: "UU-CONTEXT-6",
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
                title: "Latest video",
                publishedAt: "2024-01-10T12:00:00Z",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              errors: [{ reason: "quotaExceeded" }],
            },
          },
          403,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const context = await fetchYoutubeChannelContext({
      apiKey: "yt-key",
      channelId: "UC-CONTEXT-6",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(context.recentVideos).toEqual([
      {
        youtubeVideoId: "video-1",
        title: "Latest video",
        description: null,
        publishedAt: "2024-01-10T12:00:00Z",
        durationSeconds: null,
        isShort: null,
        viewCount: null,
        likeCount: null,
        commentCount: null,
        categoryId: null,
        categoryName: null,
        tags: [],
      },
    ]);
    expect(context.diagnostics.warnings).toEqual([
      "Recent video statistics unavailable: YouTube API quota exceeded",
    ]);
  });

  it("treats a successful channel response without items as not found", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ pageInfo: {} })));

    await expect(
      fetchYoutubeChannelContext({
        apiKey: "yt-key",
        channelId: "UC-CONTEXT-4",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "YOUTUBE_CONTEXT_FAILED",
        status: 404,
        message: "YouTube channel context not found",
      } satisfies Partial<YoutubeChannelContextProviderError>),
    );
  });

  it("throws a provider error when a 2xx playlist payload is malformed", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UC-CONTEXT-5",
              snippet: {
                title: "Channel Name",
              },
              contentDetails: {
                relatedPlaylists: {
                  uploads: "UU-CONTEXT-5",
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
              snippet: {
                publishedAt: "2024-01-10T12:00:00Z",
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchYoutubeChannelContext({
        apiKey: "yt-key",
        channelId: "UC-CONTEXT-5",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "YOUTUBE_CONTEXT_FAILED",
        status: 502,
        message: "YouTube returned an invalid uploads response",
      } satisfies Partial<YoutubeChannelContextProviderError>),
    );
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

describe("fetchYoutubeChannelPageEmailSignal", () => {
  it("extracts explicit emails from a channel about page without browser APIs", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        `<html><body><main>Business inquiries: creator [at] example [dot] com for sponsorships.</main></body></html>`,
        {
          status: 200,
          headers: {
            "content-type": "text/html",
          },
        },
      ),
    );

    const signal = await fetchYoutubeChannelPageEmailSignal({
      canonicalUrl: "https://www.youtube.com/@creator",
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.youtube.com/@creator/about",
      expect.objectContaining({
        redirect: "follow",
      }),
    );
    expect(signal.emails).toEqual(["creator@example.com"]);
    expect(signal.snippet).toContain("Business inquiries");
  });
});
