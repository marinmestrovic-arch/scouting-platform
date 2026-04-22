import type { YoutubeChannelContext } from "@scouting-platform/integrations";

const CHANNEL_URL_PREFIX = "https://www.youtube.com/channel/";
const HANDLE_URL_PREFIX = "https://www.youtube.com/";
const YOUTUBE_SHORTS_MAX_DURATION_SECONDS = 180;
const CREATOR_LIST_MONTHS_BACK = 6;
const CREATOR_LIST_MAX_VIDEOS_PER_BUCKET = 15;
const CREATOR_LIST_MIN_LONG_FORM_SECONDS = 180;
const CREATOR_LIST_SHORTS_MAX_SECONDS = 60;

export type DerivedYoutubeMetrics = {
  normalizedHandle: string | null;
  canonicalUrl: string;
  engagementRate: number | null;
  context: YoutubeChannelContext;
};

export type CreatorListYoutubeMetrics = {
  medianVideoViews: number | null;
  medianShortsViews: number | null;
  medianVideoEngagementRate: number | null;
};

function dedupeWarnings(warnings: readonly string[]): string[] {
  return Array.from(
    new Set(
      warnings
        .map((warning) => warning.trim())
        .filter((warning) => warning.length > 0),
    ),
  );
}

function normalizeNullableDurationSeconds(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round(value);
}

function normalizeStringList(values: readonly string[] | null | undefined): string[] {
  if (!values) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function normalizeNullableTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function computeMedian(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);

  if (sorted.length % 2 !== 0) {
    return sorted[middleIndex] ?? null;
  }

  const left = sorted[middleIndex - 1];
  const right = sorted[middleIndex];

  if (left === undefined || right === undefined) {
    return null;
  }

  return Math.round((left + right) / 2);
}

function computePrecisionMedian(values: readonly number[], precision: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);
  const scale = 10 ** precision;
  const median =
    sorted.length % 2 !== 0
      ? (sorted[middleIndex] ?? null)
      : sorted[middleIndex - 1] !== undefined && sorted[middleIndex] !== undefined
        ? (sorted[middleIndex - 1]! + sorted[middleIndex]!) / 2
        : null;

  if (median === null) {
    return null;
  }

  return Math.round(median * scale) / scale;
}

export function normalizeYoutubeHandle(value: string | null): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const withoutBaseUrl = trimmed.replace(/^https?:\/\/(www\.)?youtube\.com\//iu, "");

  if (withoutBaseUrl.includes("/")) {
    return trimmed.startsWith("@") ? trimmed : null;
  }

  const normalizedValue = withoutBaseUrl.replace(/^@+/u, "").trim();

  return normalizedValue ? `@${normalizedValue}` : null;
}

export function buildCanonicalYoutubeUrl(
  youtubeChannelId: string,
  handle: string | null,
): string {
  const normalizedHandle = normalizeYoutubeHandle(handle);

  if (normalizedHandle) {
    return `${HANDLE_URL_PREFIX}${normalizedHandle}`;
  }

  return `${CHANNEL_URL_PREFIX}${youtubeChannelId}`;
}

export function isYoutubeShortVideo(durationSeconds: number | null | undefined): boolean | null {
  const normalizedDurationSeconds = normalizeNullableDurationSeconds(durationSeconds);

  if (normalizedDurationSeconds === null) {
    return null;
  }

  return normalizedDurationSeconds <= YOUTUBE_SHORTS_MAX_DURATION_SECONDS;
}

export function isYoutubeLongFormVideo(durationSeconds: number | null | undefined): boolean | null {
  const isShort = isYoutubeShortVideo(durationSeconds);
  return isShort === null ? null : !isShort;
}

export function normalizeYoutubeContext(context: YoutubeChannelContext): YoutubeChannelContext {
  return {
    ...context,
    recentVideos: context.recentVideos.map((video) => {
      const durationSeconds = normalizeNullableDurationSeconds(video.durationSeconds);

      return {
        ...video,
        durationSeconds,
        isShort: isYoutubeShortVideo(durationSeconds),
        categoryId: normalizeNullableTrimmed(video.categoryId),
        categoryName: normalizeNullableTrimmed(video.categoryName),
        tags: normalizeStringList(video.tags),
      };
    }),
    diagnostics: {
      warnings: dedupeWarnings(context.diagnostics?.warnings ?? []),
    },
  };
}

export function deriveCreatorListYoutubeMetrics(
  context: YoutubeChannelContext,
  options: {
    now?: Date;
  } = {},
): CreatorListYoutubeMetrics {
  const normalizedContext = normalizeYoutubeContext(context);
  const videoViewCounts: number[] = [];
  const shortsViewCounts: number[] = [];
  const videoEngagementRates: number[] = [];
  const cutoff = new Date(options.now ?? new Date());
  cutoff.setMonth(cutoff.getMonth() - CREATOR_LIST_MONTHS_BACK);

  for (const video of normalizedContext.recentVideos) {
    const viewCount =
      typeof video.viewCount === "number" && video.viewCount > 0 ? video.viewCount : null;
    const durationSeconds = normalizeNullableDurationSeconds(video.durationSeconds);
    const publishedAt = video.publishedAt ? new Date(video.publishedAt) : null;

    if (
      viewCount === null ||
      durationSeconds === null ||
      !publishedAt ||
      Number.isNaN(publishedAt.getTime()) ||
      publishedAt < cutoff
    ) {
      continue;
    }

    if (durationSeconds > CREATOR_LIST_MIN_LONG_FORM_SECONDS) {
      if (videoViewCounts.length < CREATOR_LIST_MAX_VIDEOS_PER_BUCKET) {
        videoViewCounts.push(viewCount);

        videoEngagementRates.push(
          ((video.likeCount ?? 0) + (video.commentCount ?? 0)) / viewCount,
        );
      }

      continue;
    }

    if (
      durationSeconds <= CREATOR_LIST_SHORTS_MAX_SECONDS &&
      shortsViewCounts.length < CREATOR_LIST_MAX_VIDEOS_PER_BUCKET
    ) {
      shortsViewCounts.push(viewCount);
    }

    if (
      videoViewCounts.length >= CREATOR_LIST_MAX_VIDEOS_PER_BUCKET &&
      shortsViewCounts.length >= CREATOR_LIST_MAX_VIDEOS_PER_BUCKET
    ) {
      break;
    }
  }

  return {
    medianVideoViews: computeMedian(videoViewCounts),
    medianShortsViews: computeMedian(shortsViewCounts),
    medianVideoEngagementRate: computePrecisionMedian(videoEngagementRates, 4),
  };
}

export function deriveYoutubeMetrics(context: YoutubeChannelContext): DerivedYoutubeMetrics {
  const normalizedContext = normalizeYoutubeContext(context);
  const normalizedHandle = normalizeYoutubeHandle(normalizedContext.handle);
  const eligibleVideos = normalizedContext.recentVideos.filter(
    (video) =>
      typeof video.viewCount === "number" &&
      video.viewCount > 0 &&
      typeof video.likeCount === "number" &&
      typeof video.commentCount === "number",
  );

  const warnings = [...normalizedContext.diagnostics.warnings];

  if (normalizedContext.recentVideos.length > 0) {
    if (eligibleVideos.length === 0) {
      warnings.push("No recent uploads contained complete statistics for engagement-rate derivation.");
    } else if (eligibleVideos.length < normalizedContext.recentVideos.length) {
      warnings.push(
        `Engagement rate derived from ${eligibleVideos.length} of ${normalizedContext.recentVideos.length} recent uploads with complete statistics.`,
      );
    }
  }

  const engagementRate =
    eligibleVideos.length === 0
      ? null
      : eligibleVideos.reduce(
          (total, video) =>
            total +
              (((video.likeCount ?? 0) + (video.commentCount ?? 0)) / (video.viewCount ?? 1)) * 100,
          0,
        ) / eligibleVideos.length;

  return {
    normalizedHandle,
    canonicalUrl: buildCanonicalYoutubeUrl(context.youtubeChannelId, normalizedHandle),
    engagementRate,
    context: {
      ...normalizedContext,
      handle: normalizedHandle,
      diagnostics: {
        warnings: dedupeWarnings(warnings),
      },
    },
  };
}
