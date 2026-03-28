import { describe, expect, it } from "vitest";

import { buildCanonicalYoutubeUrl, deriveYoutubeMetrics, normalizeYoutubeHandle } from "./metrics";

describe("youtube enrichment metrics helpers", () => {
  it("normalizes handles and prefers handle-based canonical URLs", () => {
    expect(normalizeYoutubeHandle("channel-name")).toBe("@channel-name");
    expect(normalizeYoutubeHandle("@channel-name")).toBe("@channel-name");
    expect(buildCanonicalYoutubeUrl("UC-1", "channel-name")).toBe("https://www.youtube.com/@channel-name");
    expect(buildCanonicalYoutubeUrl("UC-1", null)).toBe("https://www.youtube.com/channel/UC-1");
  });

  it("computes average views and engagement rate from complete recent video statistics", () => {
    const metrics = deriveYoutubeMetrics({
      youtubeChannelId: "UC-1",
      title: "Channel",
      handle: "channel-name",
      description: "Description",
      thumbnailUrl: null,
      publishedAt: null,
      subscriberCount: 1200,
      viewCount: 1000,
      videoCount: 4,
      recentVideos: [
        {
          youtubeVideoId: "video-1",
          title: "Video 1",
          description: null,
          publishedAt: null,
          viewCount: 100,
          likeCount: 10,
          commentCount: 5,
        },
        {
          youtubeVideoId: "video-2",
          title: "Video 2",
          description: null,
          publishedAt: null,
          viewCount: 200,
          likeCount: 20,
          commentCount: 10,
        },
      ],
      diagnostics: {
        warnings: [],
      },
    });

    expect(metrics.normalizedHandle).toBe("@channel-name");
    expect(metrics.canonicalUrl).toBe("https://www.youtube.com/@channel-name");
    expect(metrics.averageViews).toBe(250);
    expect(metrics.engagementRate).toBeCloseTo(15, 5);
    expect(metrics.context.diagnostics.warnings).toEqual([]);
  });

  it("keeps engagement rate best-effort and records diagnostics when usable video stats are incomplete", () => {
    const metrics = deriveYoutubeMetrics({
      youtubeChannelId: "UC-2",
      title: "Channel",
      handle: "@channel-name",
      description: null,
      thumbnailUrl: null,
      publishedAt: null,
      subscriberCount: null,
      viewCount: 500,
      videoCount: 5,
      recentVideos: [
        {
          youtubeVideoId: "video-1",
          title: "Video 1",
          description: null,
          publishedAt: null,
          viewCount: null,
          likeCount: null,
          commentCount: null,
        },
        {
          youtubeVideoId: "video-2",
          title: "Video 2",
          description: null,
          publishedAt: null,
          viewCount: 0,
          likeCount: 10,
          commentCount: 5,
        },
      ],
      diagnostics: {
        warnings: ["Recent video statistics unavailable: YouTube API quota exceeded"],
      },
    });

    expect(metrics.averageViews).toBe(100);
    expect(metrics.engagementRate).toBeNull();
    expect(metrics.context.diagnostics.warnings).toEqual([
      "Recent video statistics unavailable: YouTube API quota exceeded",
      "No recent uploads contained complete statistics for engagement-rate derivation.",
    ]);
  });

  it("records partial-coverage diagnostics when engagement rate is derived from a subset of recent uploads", () => {
    const metrics = deriveYoutubeMetrics({
      youtubeChannelId: "UC-3",
      title: "Channel",
      handle: "@channel-name",
      description: null,
      thumbnailUrl: null,
      publishedAt: null,
      subscriberCount: null,
      viewCount: 900,
      videoCount: 3,
      recentVideos: [
        {
          youtubeVideoId: "video-1",
          title: "Video 1",
          description: null,
          publishedAt: null,
          viewCount: 100,
          likeCount: 8,
          commentCount: 2,
        },
        {
          youtubeVideoId: "video-2",
          title: "Video 2",
          description: null,
          publishedAt: null,
          viewCount: null,
          likeCount: null,
          commentCount: null,
        },
      ],
      diagnostics: {
        warnings: [],
      },
    });

    expect(metrics.engagementRate).toBeCloseTo(10, 5);
    expect(metrics.context.diagnostics.warnings).toEqual([
      "Engagement rate derived from 1 of 2 recent uploads with complete statistics.",
    ]);
  });
});
