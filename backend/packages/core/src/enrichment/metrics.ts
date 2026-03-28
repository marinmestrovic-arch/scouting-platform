import type { YoutubeChannelContext } from "@scouting-platform/integrations";

const CHANNEL_URL_PREFIX = "https://www.youtube.com/channel/";
const HANDLE_URL_PREFIX = "https://www.youtube.com/";

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

export function deriveYoutubeMetrics(context: YoutubeChannelContext): DerivedYoutubeMetrics {
  const normalizedHandle = normalizeYoutubeHandle(context.handle);
  const eligibleVideos = context.recentVideos.filter(
    (video) =>
      typeof video.viewCount === "number" &&
      video.viewCount > 0 &&
      typeof video.likeCount === "number" &&
      typeof video.commentCount === "number",
  );

  const warnings = [...(context.diagnostics?.warnings ?? [])];

  if (context.recentVideos.length > 0) {
    if (eligibleVideos.length === 0) {
      warnings.push("No recent uploads contained complete statistics for engagement-rate derivation.");
    } else if (eligibleVideos.length < context.recentVideos.length) {
      warnings.push(
        `Engagement rate derived from ${eligibleVideos.length} of ${context.recentVideos.length} recent uploads with complete statistics.`,
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
    averageViews: computeYoutubeAverageViews(context),
    engagementRate,
    context: {
      ...context,
      handle: normalizedHandle,
      diagnostics: {
        warnings: dedupeWarnings(warnings),
      },
    },
  };
}
