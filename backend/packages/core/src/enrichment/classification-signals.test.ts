import { describe, expect, it } from "vitest";

import {
  deriveChannelClassificationSignals,
  deriveContentMixHint,
  deriveUploadCadenceHint,
  extractTopKeywordsFromTitles,
  inferTopicClusters,
} from "./classification-signals";

const BASE_CONTEXT = {
  youtubeChannelId: "UC-CLASSIFY-1",
  title: "Channel Name",
  handle: "@channel-name",
  description: "Channel description",
  thumbnailUrl: null,
  publishedAt: null,
  defaultLanguage: null,
  subscriberCount: 1200,
  viewCount: 45000,
  videoCount: 87,
  diagnostics: {
    warnings: [],
  },
};

describe("classification-signals", () => {
  it("extracts scouting-friendly title keywords", () => {
    const keywords = extractTopKeywordsFromTitles([
      "BMW restoration detail wash test",
      "Detailing a Ferrari after a road trip",
      "BMW wash and restoration guide",
    ]);

    expect(keywords.slice(0, 4)).toEqual(["bmw", "restoration", "wash", "detail"]);
    expect(keywords).toEqual(
      expect.arrayContaining(["detailing", "ferrari", "road", "trip", "guide"]),
    );
  });

  it("derives topic clusters, dominant category, mixed format, and weekly cadence", () => {
    const signals = deriveChannelClassificationSignals({
      ...BASE_CONTEXT,
      recentVideos: [
        {
          youtubeVideoId: "video-1",
          title: "BMW restoration guide",
          description: null,
          publishedAt: "2026-04-12T12:00:00Z",
          viewCount: 100,
          likeCount: 10,
          commentCount: 5,
          durationSeconds: 900,
          isShort: false,
          categoryId: "2",
          categoryName: "Autos & Vehicles",
          tags: [],
        },
        {
          youtubeVideoId: "video-2",
          title: "BMW wash comparison",
          description: null,
          publishedAt: "2026-04-05T12:00:00Z",
          viewCount: 200,
          likeCount: 20,
          commentCount: 10,
          durationSeconds: 45,
          isShort: true,
          categoryId: "2",
          categoryName: "Autos & Vehicles",
          tags: [],
        },
        {
          youtubeVideoId: "video-3",
          title: "Ferrari detailing test",
          description: null,
          publishedAt: "2026-03-29T12:00:00Z",
          viewCount: 300,
          likeCount: 30,
          commentCount: 15,
          durationSeconds: 1200,
          isShort: false,
          categoryId: "2",
          categoryName: "Autos & Vehicles",
          tags: [],
        },
      ],
    });

    expect(signals.topKeywords).toContain("bmw");
    expect(signals.topicClusters).toEqual(
      expect.arrayContaining(["automotive_detailing", "reviews_comparisons"]),
    );
    expect(signals.dominantYoutubeCategoryName).toBe("Autos & Vehicles");
    expect(signals.contentMixHint).toBe("mixed");
    expect(signals.uploadCadenceHint).toBe("weekly");
  });

  it("falls back to category-based clusters and cadence buckets when keyword evidence is weak", () => {
    const context = {
      ...BASE_CONTEXT,
      recentVideos: [
        {
          youtubeVideoId: "video-1",
          title: "Episode 1",
          description: null,
          publishedAt: "2026-04-10T12:00:00Z",
          viewCount: 100,
          likeCount: 10,
          commentCount: 5,
          durationSeconds: 1200,
          isShort: false,
          categoryId: "27",
          categoryName: "Education",
          tags: [],
        },
        {
          youtubeVideoId: "video-2",
          title: "Episode 2",
          description: null,
          publishedAt: "2026-03-10T12:00:00Z",
          viewCount: 100,
          likeCount: 10,
          commentCount: 5,
          durationSeconds: 1400,
          isShort: false,
          categoryId: "27",
          categoryName: "Education",
          tags: [],
        },
      ],
    };

    expect(inferTopicClusters([], "Education")).toEqual(["education"]);
    expect(deriveContentMixHint(context)).toBe("long_form");
    expect(deriveUploadCadenceHint(context)).toBe("monthly");
  });

  it("classifies 60-180 second uploads as shorts when the YouTube context marks them that way", () => {
    const context = {
      ...BASE_CONTEXT,
      recentVideos: [
        {
          youtubeVideoId: "video-1",
          title: "Short 1",
          description: null,
          publishedAt: "2026-04-10T12:00:00Z",
          viewCount: 100,
          likeCount: 10,
          commentCount: 5,
          durationSeconds: 75,
          isShort: true,
          categoryId: "24",
          categoryName: "Entertainment",
          tags: [],
        },
        {
          youtubeVideoId: "video-2",
          title: "Short 2",
          description: null,
          publishedAt: "2026-04-09T12:00:00Z",
          viewCount: 120,
          likeCount: 12,
          commentCount: 6,
          durationSeconds: 150,
          isShort: true,
          categoryId: "24",
          categoryName: "Entertainment",
          tags: [],
        },
      ],
    };

    expect(deriveContentMixHint(context)).toBe("shorts");
  });
});
