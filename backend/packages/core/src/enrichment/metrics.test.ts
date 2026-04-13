import { describe, expect, it } from "vitest";

import {
  buildCanonicalYoutubeUrl,
  deriveYoutubeMetrics,
  isYoutubeLongFormVideo,
  isYoutubeShortVideo,
  normalizeYoutubeHandle,
} from "./metrics";

describe("youtube enrichment metrics helpers", () => {
  it("normalizes handles and prefers handle-based canonical URLs", () => {
    expect(normalizeYoutubeHandle("channel-name")).toBe("@channel-name");
    expect(normalizeYoutubeHandle("@channel-name")).toBe("@channel-name");
    expect(buildCanonicalYoutubeUrl("UC-1", "channel-name")).toBe("https://www.youtube.com/@channel-name");
    expect(buildCanonicalYoutubeUrl("UC-1", null)).toBe("https://www.youtube.com/channel/UC-1");
  });

  it("classifies shorts deterministically from duration", () => {
    expect(isYoutubeShortVideo(180)).toBe(true);
    expect(isYoutubeShortVideo(181)).toBe(false);
    expect(isYoutubeLongFormVideo(181)).toBe(true);
    expect(isYoutubeLongFormVideo(180)).toBe(false);
    expect(isYoutubeShortVideo(null)).toBeNull();
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
          durationSeconds: 120,
          isShort: true,
          viewCount: 100,
          likeCount: 10,
          commentCount: 5,
          categoryId: "20",
          tags: ["gameplay"],
        },
        {
          youtubeVideoId: "video-2",
          title: "Video 2",
          description: null,
          publishedAt: null,
          durationSeconds: 900,
          isShort: false,
          viewCount: 200,
          likeCount: 20,
          commentCount: 10,
          categoryId: "24",
          tags: ["analysis"],
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
    expect(metrics.context.recentVideos.map((video) => video.isShort)).toEqual([true, false]);
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
          durationSeconds: 95,
          isShort: true,
          viewCount: null,
          likeCount: null,
          commentCount: null,
          categoryId: null,
          tags: [],
        },
        {
          youtubeVideoId: "video-2",
          title: "Video 2",
          description: null,
          publishedAt: null,
          durationSeconds: 0,
          isShort: true,
          viewCount: 0,
          likeCount: 10,
          commentCount: 5,
          categoryId: null,
          tags: [],
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
          durationSeconds: 720,
          isShort: false,
          viewCount: 100,
          likeCount: 8,
          commentCount: 2,
          categoryId: "20",
          tags: ["news"],
        },
        {
          youtubeVideoId: "video-2",
          title: "Video 2",
          description: null,
          publishedAt: null,
          durationSeconds: 60,
          isShort: true,
          viewCount: null,
          likeCount: null,
          commentCount: null,
          categoryId: "20",
          tags: [],
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
