import type { YoutubeChannelContext } from "@scouting-platform/integrations";

const CHANNEL_URL_PREFIX = "https://www.youtube.com/channel/";
const HANDLE_URL_PREFIX = "https://www.youtube.com/";
const YOUTUBE_SHORTS_MAX_DURATION_SECONDS = 180;

export type DerivedYoutubeMetrics = {
  normalizedHandle: string | null;
  canonicalUrl: string;
  averageViews: number | null;
  engagementRate: number | null;
  context: YoutubeChannelContext;
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

export function computeYoutubeAverageViews(context: YoutubeChannelContext): number | null {
  if (
    context.viewCount === null ||
    context.videoCount === null ||
    !Number.isFinite(context.viewCount) ||
    !Number.isFinite(context.videoCount) ||
    context.videoCount <= 0
  ) {
    return null;
  }

  return Math.round(context.viewCount / context.videoCount);
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
        tags: normalizeStringList(video.tags),
      };
    }),
    diagnostics: {
      warnings: dedupeWarnings(context.diagnostics?.warnings ?? []),
    },
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
    averageViews: computeYoutubeAverageViews(normalizedContext),
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
