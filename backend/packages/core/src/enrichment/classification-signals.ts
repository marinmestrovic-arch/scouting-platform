import type { YoutubeChannelContext } from "@scouting-platform/integrations";

import { isYoutubeShortVideo } from "./metrics";
const MAX_KEYWORDS = 12;
const MAX_TOPIC_CLUSTERS = 5;

const stopwords = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "that",
  "this",
  "these",
  "those",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "from",
  "with",
  "by",
  "about",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "its",
  "it's",
  "he",
  "she",
  "they",
  "them",
  "their",
  "we",
  "you",
  "your",
  "our",
  "i",
  "me",
  "my",
  "mine",
  "his",
  "her",
  "hers",
  "there",
  "here",
  "how",
  "what",
  "why",
  "when",
  "where",
  "who",
  "which",
  "will",
  "would",
  "should",
  "could",
  "can",
  "do",
  "does",
  "did",
  "done",
  "into",
  "onto",
  "over",
  "under",
  "after",
  "before",
  "again",
  "new",
  "best",
  "top",
  "vs",
  "video",
  "official",
  "full",
  "part",
  "ep",
  "episode",
  "ft",
  "feat",
]);

type TopicClusterRule = {
  cluster: string;
  keywords: readonly string[];
};

const topicClusterRules: TopicClusterRule[] = [
  {
    cluster: "automotive_detailing",
    keywords: [
      "car",
      "cars",
      "detailing",
      "cleaning",
      "wash",
      "restoration",
      "bmw",
      "audi",
      "mercedes",
      "porsche",
      "ferrari",
    ],
  },
  {
    cluster: "gaming",
    keywords: [
      "game",
      "gaming",
      "games",
      "minecraft",
      "roblox",
      "fortnite",
      "csgo",
      "valorant",
      "fifa",
      "stream",
    ],
  },
  {
    cluster: "comedy_entertainment",
    keywords: ["prank", "funny", "comedy", "meme", "memes", "jokes", "laugh"],
  },
  {
    cluster: "beauty_fashion",
    keywords: ["makeup", "beauty", "skincare", "fashion", "outfit", "style", "hair"],
  },
  {
    cluster: "food_cooking",
    keywords: ["recipe", "cooking", "food", "kitchen", "meal", "baking"],
  },
  {
    cluster: "fitness_health",
    keywords: ["workout", "fitness", "gym", "exercise", "bodybuilding", "weightloss"],
  },
  {
    cluster: "travel",
    keywords: ["travel", "trip", "hotel", "flight", "country", "city", "vacation"],
  },
  {
    cluster: "finance_investing",
    keywords: ["crypto", "bitcoin", "trading", "stocks", "finance", "investing", "money"],
  },
  {
    cluster: "tutorial_education",
    keywords: ["tutorial", "howto", "guide", "tips", "explained", "learn"],
  },
  {
    cluster: "reviews_comparisons",
    keywords: ["review", "unboxing", "test", "comparison", "vs"],
  },
  {
    cluster: "podcast_interview",
    keywords: ["podcast", "interview", "conversation"],
  },
  {
    cluster: "news_politics",
    keywords: ["news", "politics", "war", "election", "update"],
  },
  {
    cluster: "sports",
    keywords: ["football", "soccer", "nba", "ufc", "boxing", "sport", "sports"],
  },
  {
    cluster: "music",
    keywords: ["music", "song", "album", "rap", "beat", "lyrics", "reaction"],
  },
  {
    cluster: "lifestyle_vlog",
    keywords: ["vlog", "daily", "day", "weekend", "routine", "life"],
  },
];

export type ChannelClassificationDerivedSignals = {
  topKeywords: string[];
  topicClusters: string[];
  dominantYoutubeCategoryName: string | null;
  contentMixHint: "long_form" | "shorts" | "mixed" | null;
  uploadCadenceHint: "weekly" | "biweekly" | "monthly" | "irregular" | null;
};

function mode(values: readonly string[]): string | null {
  if (values.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[mid] ?? null
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function extractTopKeywordsFromTitles(
  titles: readonly string[],
  maxKeywords = MAX_KEYWORDS,
): string[] {
  const counts = new Map<string, number>();

  for (const title of titles) {
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

    for (const word of words) {
      if (word.length < 3 || stopwords.has(word) || /^\d+$/.test(word)) {
        continue;
      }

      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

export function inferTopicClusters(
  keywords: readonly string[],
  dominantCategoryName: string | null,
): string[] {
  const keywordSet = new Set(keywords.map((keyword) => keyword.toLowerCase()));
  const clusters = topicClusterRules
    .filter((rule) => rule.keywords.some((keyword) => keywordSet.has(keyword)))
    .map((rule) => rule.cluster);

  if (clusters.length > 0) {
    return clusters.slice(0, MAX_TOPIC_CLUSTERS);
  }

  const normalizedCategory = dominantCategoryName?.toLowerCase() ?? "";

  if (normalizedCategory.includes("gaming")) {
    return ["gaming"];
  }
  if (normalizedCategory.includes("autos")) {
    return ["automotive"];
  }
  if (normalizedCategory.includes("education")) {
    return ["education"];
  }
  if (normalizedCategory.includes("entertainment")) {
    return ["entertainment"];
  }
  if (normalizedCategory.includes("people")) {
    return ["lifestyle"];
  }
  if (normalizedCategory.includes("howto")) {
    return ["howto_style"];
  }
  if (normalizedCategory.includes("science")) {
    return ["science_technology"];
  }
  if (normalizedCategory.includes("travel")) {
    return ["travel"];
  }

  return [];
}

export function deriveContentMixHint(
  context: YoutubeChannelContext,
): ChannelClassificationDerivedSignals["contentMixHint"] {
  const classifiedVideos = context.recentVideos
    .map((video) => video.isShort ?? isYoutubeShortVideo(video.durationSeconds))
    .filter((isShort): isShort is boolean => typeof isShort === "boolean");

  if (classifiedVideos.length === 0) {
    return null;
  }

  const shortCount = classifiedVideos.filter((isShort) => isShort).length;

  if (shortCount === classifiedVideos.length) {
    return "shorts";
  }

  if (shortCount === 0) {
    return "long_form";
  }

  return "mixed";
}

export function deriveUploadCadenceHint(
  context: YoutubeChannelContext,
): ChannelClassificationDerivedSignals["uploadCadenceHint"] {
  const timestamps = context.recentVideos
    .map((video) => {
      if (!video.publishedAt) {
        return null;
      }

      const parsed = Date.parse(video.publishedAt);
      return Number.isFinite(parsed) ? parsed : null;
    })
    .filter((timestamp): timestamp is number => timestamp !== null)
    .sort((left, right) => right - left);

  if (timestamps.length < 2) {
    return null;
  }

  const gapDays: number[] = [];

  for (let index = 1; index < timestamps.length; index += 1) {
    const previous = timestamps[index - 1];
    const current = timestamps[index];

    if (previous === undefined || current === undefined) {
      continue;
    }

    gapDays.push((previous - current) / (24 * 60 * 60 * 1000));
  }

  const medianGapDays = median(gapDays);

  if (medianGapDays === null) {
    return null;
  }

  if (medianGapDays <= 10) {
    return "weekly";
  }

  if (medianGapDays <= 20) {
    return "biweekly";
  }

  if (medianGapDays <= 40) {
    return "monthly";
  }

  return "irregular";
}

export function deriveChannelClassificationSignals(
  context: YoutubeChannelContext,
): ChannelClassificationDerivedSignals {
  const topKeywords = extractTopKeywordsFromTitles(
    context.recentVideos.map((video) => video.title).filter((title) => title.trim().length > 0),
  );
  const dominantYoutubeCategoryName = mode(
    context.recentVideos
      .map((video) => video.categoryName)
      .filter((categoryName): categoryName is string => Boolean(categoryName)),
  );

  return {
    topKeywords,
    topicClusters: inferTopicClusters(topKeywords, dominantYoutubeCategoryName),
    dominantYoutubeCategoryName,
    contentMixHint: deriveContentMixHint(context),
    uploadCadenceHint: deriveUploadCadenceHint(context),
  };
}
