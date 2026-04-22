import { describe, expect, it } from "vitest";

import {
  buildCanonicalYoutubeUrl,
  deriveCreatorListYoutubeMetrics,
  deriveYoutubeMetrics,
  normalizeYoutubeHandle,
} from "./metrics";

describe("youtube enrichment metrics helpers", () => {
  it("normalizes handles and prefers handle-based canonical URLs", () => {
    expect(normalizeYoutubeHandle("channel-name")).toBe("@channel-name");
    expect(normalizeYoutubeHandle("@channel-name")).toBe("@channel-name");
    expect(buildCanonicalYoutubeUrl("UC-1", "channel-name")).toBe("https://www.youtube.com/@channel-name");
    expect(buildCanonicalYoutubeUrl("UC-1", null)).toBe("https://www.youtube.com/channel/UC-1");
  });

  it("computes engagement rate from complete recent video statistics", () => {
    const metrics = deriveYoutubeMetrics({
      youtubeChannelId: "UC-1",
      title: "Channel",
      handle: "channel-name",
      description: "Description",
      thumbnailUrl: null,
      publishedAt: null,
      defaultLanguage: null,
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
          durationSeconds: null,
          isShort: null,
          categoryId: null,
          categoryName: null,
          tags: [],
        },
        {
          youtubeVideoId: "video-2",
          title: "Video 2",
          description: null,
          publishedAt: null,
          viewCount: 200,
          likeCount: 20,
          commentCount: 10,
          durationSeconds: null,
          isShort: null,
          categoryId: null,
          categoryName: null,
          tags: [],
        },
      ],
      diagnostics: {
        warnings: [],
      },
    });

    expect(metrics.normalizedHandle).toBe("@channel-name");
    expect(metrics.canonicalUrl).toBe("https://www.youtube.com/@channel-name");
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
      defaultLanguage: null,
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
          durationSeconds: null,
          isShort: null,
          categoryId: null,
          categoryName: null,
          tags: [],
        },
        {
          youtubeVideoId: "video-2",
          title: "Video 2",
          description: null,
          publishedAt: null,
          viewCount: 0,
          likeCount: 10,
          commentCount: 5,
          durationSeconds: null,
          isShort: null,
          categoryId: null,
          categoryName: null,
          tags: [],
        },
      ],
      diagnostics: {
        warnings: ["Recent video statistics unavailable: YouTube API quota exceeded"],
      },
    });

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
      defaultLanguage: null,
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
          durationSeconds: null,
          isShort: null,
          categoryId: null,
          categoryName: null,
          tags: [],
        },
        {
          youtubeVideoId: "video-2",
          title: "Video 2",
          description: null,
          publishedAt: null,
          viewCount: null,
          likeCount: null,
          commentCount: null,
          durationSeconds: null,
          isShort: null,
          categoryId: null,
          categoryName: null,
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

  it("derives creator-list YouTube medians using long-form and Shorts thresholds", () => {
    const recentPublishedAt = "2026-04-01T00:00:00Z";
    const metrics = deriveCreatorListYoutubeMetrics(
      {
        youtubeChannelId: "UC-4",
        title: "Channel",
        handle: "@channel-name",
        description: null,
        thumbnailUrl: null,
        publishedAt: null,
        defaultLanguage: null,
        subscriberCount: null,
        viewCount: 2_000,
        videoCount: 8,
        recentVideos: [
          {
            youtubeVideoId: "video-1",
            title: "Long 1",
            description: null,
            publishedAt: recentPublishedAt,
            viewCount: 100,
            likeCount: 10,
            commentCount: 5,
            durationSeconds: 600,
            isShort: false,
            categoryId: null,
            categoryName: null,
            tags: [],
          },
          {
            youtubeVideoId: "video-2",
            title: "Long 2",
            description: null,
            publishedAt: recentPublishedAt,
            viewCount: 300,
            likeCount: 24,
            commentCount: 6,
            durationSeconds: 540,
            isShort: false,
            categoryId: null,
            categoryName: null,
            tags: [],
          },
          {
            youtubeVideoId: "video-3",
            title: "Long 3",
            description: null,
            publishedAt: recentPublishedAt,
            viewCount: 500,
            likeCount: 20,
            commentCount: 5,
            durationSeconds: 480,
            isShort: false,
            categoryId: null,
            categoryName: null,
            tags: [],
          },
          {
            youtubeVideoId: "video-4",
            title: "Short 1",
            description: null,
            publishedAt: recentPublishedAt,
            viewCount: 50,
            likeCount: 5,
            commentCount: 1,
            durationSeconds: 30,
            isShort: true,
            categoryId: null,
            categoryName: null,
            tags: [],
          },
          {
            youtubeVideoId: "video-5",
            title: "Short 2",
            description: null,
            publishedAt: recentPublishedAt,
            viewCount: 150,
            likeCount: 4,
            commentCount: 1,
            durationSeconds: 45,
            isShort: true,
            categoryId: null,
            categoryName: null,
            tags: [],
          },
          {
            youtubeVideoId: "video-6",
            title: "Ignored Mid-Length",
            description: null,
            publishedAt: recentPublishedAt,
            viewCount: 9_999,
            likeCount: 1,
            commentCount: 1,
            durationSeconds: 120,
            isShort: true,
            categoryId: null,
            categoryName: null,
            tags: [],
          },
        ],
        diagnostics: {
          warnings: [],
        },
      },
      { now: new Date("2026-04-21T00:00:00Z") },
    );

    expect(metrics).toEqual({
      medianVideoViews: 300,
      medianShortsViews: 100,
      medianVideoEngagementRate: 0.1,
    });
  });

  it("derives creator-list metrics from recent uploads only and caps each sample at 15 videos", () => {
    const recentLongVideos = Array.from({ length: 16 }, (_, index) => ({
      youtubeVideoId: `long-${index + 1}`,
      title: `Long ${index + 1}`,
      description: null,
      publishedAt: "2026-04-01T00:00:00Z",
      viewCount: (index + 1) * 100,
      likeCount: 10,
      commentCount: 0,
      durationSeconds: 600,
      isShort: false,
      categoryId: null,
      categoryName: null,
      tags: [],
    }));
    const metrics = deriveCreatorListYoutubeMetrics(
      {
        youtubeChannelId: "UC-5",
        title: "Channel",
        handle: "@channel-name",
        description: null,
        thumbnailUrl: null,
        publishedAt: null,
        defaultLanguage: null,
        subscriberCount: null,
        viewCount: null,
        videoCount: null,
        recentVideos: [
          ...recentLongVideos,
          {
            youtubeVideoId: "old-long",
            title: "Old Long",
            description: null,
            publishedAt: "2025-01-01T00:00:00Z",
            viewCount: 999_999,
            likeCount: 999,
            commentCount: 999,
            durationSeconds: 600,
            isShort: false,
            categoryId: null,
            categoryName: null,
            tags: [],
          },
        ],
        diagnostics: {
          warnings: [],
        },
      },
      { now: new Date("2026-04-21T00:00:00Z") },
    );

    expect(metrics.medianVideoViews).toBe(800);
    expect(metrics.medianVideoEngagementRate).toBe(0.0125);
  });
});
