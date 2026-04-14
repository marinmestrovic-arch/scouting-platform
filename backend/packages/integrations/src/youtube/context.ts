import { z } from "zod";

const DEFAULT_MAX_INSPECTED_UPLOADS = 50;
const DEFAULT_MIN_LONG_FORM_VIDEOS = 12;
const PLAYLIST_ITEMS_PAGE_SIZE = 25;
const YOUTUBE_SHORTS_MAX_DURATION_SECONDS = 180;

const contextInputSchema = z
  .object({
    apiKey: z.string().trim().min(1),
    channelId: z.string().trim().min(1),
    maxVideos: z
      .number()
      .int()
      .min(1)
      .max(DEFAULT_MAX_INSPECTED_UPLOADS)
      .default(DEFAULT_MAX_INSPECTED_UPLOADS),
    minLongFormVideos: z
      .number()
      .int()
      .min(1)
      .max(DEFAULT_MAX_INSPECTED_UPLOADS)
      .default(DEFAULT_MIN_LONG_FORM_VIDEOS),
  })
  .transform((value) => ({
    ...value,
    minLongFormVideos: Math.min(value.minLongFormVideos, value.maxVideos),
  }));

const channelResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        snippet: z.object({
          title: z.string(),
          description: z.string().optional(),
          customUrl: z.string().optional(),
          publishedAt: z.string().optional(),
          defaultLanguage: z.string().optional(),
          thumbnails: z
            .object({
              high: z.object({ url: z.string().optional() }).optional(),
              medium: z.object({ url: z.string().optional() }).optional(),
              default: z.object({ url: z.string().optional() }).optional(),
            })
            .optional(),
        }),
        statistics: z
          .object({
            subscriberCount: z.string().optional(),
            viewCount: z.string().optional(),
            videoCount: z.string().optional(),
          })
          .optional(),
        contentDetails: z
          .object({
            relatedPlaylists: z
              .object({
                uploads: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional()
    .default([]),
});

const playlistItemsResponseSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z
    .array(
      z.object({
        contentDetails: z
          .object({
            videoId: z.string().optional(),
          })
          .optional(),
        snippet: z.object({
          title: z.string(),
          description: z.string().optional(),
          publishedAt: z.string().optional(),
        }),
      }),
    )
    .optional()
    .default([]),
});

const videosResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        contentDetails: z
          .object({
            duration: z.string().optional(),
          })
          .optional(),
        snippet: z
          .object({
            categoryId: z.string().optional(),
            tags: z.array(z.string()).optional(),
          })
          .optional(),
        statistics: z
          .object({
            viewCount: z.string().optional(),
            likeCount: z.string().optional(),
            commentCount: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional()
    .default([]),
});

const errorResponseSchema = z.object({
  error: z
    .object({
      errors: z
        .array(
          z.object({
            reason: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const YOUTUBE_CHANNELS_URL = "https://youtube.googleapis.com/youtube/v3/channels";
const YOUTUBE_PLAYLIST_ITEMS_URL = "https://youtube.googleapis.com/youtube/v3/playlistItems";
const YOUTUBE_VIDEOS_URL = "https://youtube.googleapis.com/youtube/v3/videos";

const quotaErrorReasons = new Set([
  "quotaExceeded",
  "dailyLimitExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

const authErrorReasons = new Set([
  "keyInvalid",
  "forbidden",
  "accessNotConfigured",
  "ipRefererBlocked",
]);

export type YoutubeChannelContextErrorCode =
  | "YOUTUBE_QUOTA_EXCEEDED"
  | "YOUTUBE_AUTH_FAILED"
  | "YOUTUBE_CONTEXT_FAILED";

export const youtubeChannelContextSchema = z.object({
  youtubeChannelId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  handle: z.string().trim().nullable(),
  description: z.string().trim().nullable(),
  thumbnailUrl: z.string().trim().nullable(),
  publishedAt: z.string().trim().nullable(),
  defaultLanguage: z.string().trim().nullable(),
  subscriberCount: z.number().nullable(),
  viewCount: z.number().nullable(),
  videoCount: z.number().nullable(),
  recentVideos: z.array(
    z.object({
      youtubeVideoId: z.string().trim().nullable(),
      title: z.string().trim().min(1),
      description: z.string().trim().nullable(),
      publishedAt: z.string().trim().nullable(),
      durationSeconds: z.number().int().nonnegative().nullable().optional().default(null),
      isShort: z.boolean().nullable().optional().default(null),
      viewCount: z.number().nullable().optional().default(null),
      likeCount: z.number().nullable().optional().default(null),
      commentCount: z.number().nullable().optional().default(null),
      categoryId: z.string().trim().nullable().optional().default(null),
      tags: z.array(z.string().trim().min(1)).optional().default([]),
    }),
  ),
  diagnostics: z
    .object({
      warnings: z.array(z.string().trim().min(1)).default([]),
    })
    .optional()
    .default({
      warnings: [],
    }),
});

export type YoutubeChannelContext = z.infer<typeof youtubeChannelContextSchema>;

type YoutubeChannelContextDraft = {
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  defaultLanguage: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  recentVideos: Array<{
    youtubeVideoId: string | null;
    title: string;
    description: string | null;
    publishedAt: string | null;
    durationSeconds: number | null;
    isShort: boolean | null;
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
    categoryId: string | null;
    tags: string[];
  }>;
  diagnostics: {
    warnings: string[];
  };
};

export type YoutubeShortClassifier = (durationSeconds: number | null) => boolean | null;
export type FetchYoutubeChannelContextInput = z.input<typeof contextInputSchema> & {
  classifyIsShort?: YoutubeShortClassifier;
};

export class YoutubeChannelContextProviderError extends Error {
  readonly code: YoutubeChannelContextErrorCode;
  readonly status: number;

  constructor(code: YoutubeChannelContextErrorCode, status: number, message: string) {
    super(message);
    this.name = "YoutubeChannelContextProviderError";
    this.code = code;
    this.status = status;
  }
}

export function isYoutubeChannelContextProviderError(
  error: unknown,
): error is YoutubeChannelContextProviderError {
  return error instanceof YoutubeChannelContextProviderError;
}

function toNullableTrimmed(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function pickThumbnailUrl(
  thumbnails:
    | {
        high?: { url?: string | undefined } | undefined;
        medium?: { url?: string | undefined } | undefined;
        default?: { url?: string | undefined } | undefined;
      }
    | undefined,
): string | null {
  return (
    toNullableTrimmed(thumbnails?.high?.url) ??
    toNullableTrimmed(thumbnails?.medium?.url) ??
    toNullableTrimmed(thumbnails?.default?.url)
  );
}

function toNullableNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTrimmedStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
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

function parseDurationToSeconds(value: string | undefined): number | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const match =
    /^P(?:(?<days>\d+)D)?(?:T(?:(?<hours>\d+)H)?(?:(?<minutes>\d+)M)?(?:(?<seconds>\d+)S)?)?$/iu.exec(
      trimmed,
    );

  if (!match?.groups) {
    return null;
  }

  const { days: rawDays, hours: rawHours, minutes: rawMinutes, seconds: rawSeconds } = match.groups;

  if (!rawDays && !rawHours && !rawMinutes && !rawSeconds) {
    return null;
  }

  const days = Number(rawDays ?? 0);
  const hours = Number(rawHours ?? 0);
  const minutes = Number(rawMinutes ?? 0);
  const seconds = Number(rawSeconds ?? 0);

  if (![days, hours, minutes, seconds].every(Number.isFinite)) {
    return null;
  }

  return days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60 + seconds;
}

function defaultClassifyIsShort(durationSeconds: number | null): boolean | null {
  if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return null;
  }

  return durationSeconds <= YOUTUBE_SHORTS_MAX_DURATION_SECONDS;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function parseChannelResponse(payload: unknown): z.output<typeof channelResponseSchema> {
  const parsed = channelResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new YoutubeChannelContextProviderError(
      "YOUTUBE_CONTEXT_FAILED",
      502,
      "YouTube returned an invalid channel response",
    );
  }

  return parsed.data;
}

function parsePlaylistItemsResponse(payload: unknown): z.output<typeof playlistItemsResponseSchema> {
  const parsed = playlistItemsResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new YoutubeChannelContextProviderError(
      "YOUTUBE_CONTEXT_FAILED",
      502,
      "YouTube returned an invalid uploads response",
    );
  }

  return parsed.data;
}

function parseVideosResponse(payload: unknown): z.output<typeof videosResponseSchema> {
  const parsed = videosResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new YoutubeChannelContextProviderError(
      "YOUTUBE_CONTEXT_FAILED",
      502,
      "YouTube returned an invalid video statistics response",
    );
  }

  return parsed.data;
}

async function assertSuccessResponseOrThrow(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  const errorBody = errorResponseSchema.safeParse(await parseJsonResponse(response));
  const reasons = new Set(
    (errorBody.success ? errorBody.data.error?.errors ?? [] : [])
      .map((item) => item.reason?.trim())
      .filter((reason): reason is string => Boolean(reason)),
  );

  for (const reason of reasons) {
    if (quotaErrorReasons.has(reason)) {
      throw new YoutubeChannelContextProviderError(
        "YOUTUBE_QUOTA_EXCEEDED",
        429,
        "YouTube API quota exceeded",
      );
    }
  }

  for (const reason of reasons) {
    if (authErrorReasons.has(reason)) {
      throw new YoutubeChannelContextProviderError(
        "YOUTUBE_AUTH_FAILED",
        401,
        "YouTube API key is invalid or unauthorized",
      );
    }
  }

  throw new YoutubeChannelContextProviderError(
    "YOUTUBE_CONTEXT_FAILED",
    502,
    "YouTube channel context request failed",
  );
}

function buildChannelsUrl(input: z.output<typeof contextInputSchema>): string {
  const params = new URLSearchParams({
    key: input.apiKey,
    part: "snippet,statistics,contentDetails",
    id: input.channelId,
  });

  return `${YOUTUBE_CHANNELS_URL}?${params.toString()}`;
}

function buildPlaylistItemsUrl(
  apiKey: string,
  uploadsPlaylistId: string,
  maxVideos: number,
  pageToken?: string,
): string {
  const params = new URLSearchParams({
    key: apiKey,
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(maxVideos),
  });

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  return `${YOUTUBE_PLAYLIST_ITEMS_URL}?${params.toString()}`;
}

function buildVideosUrl(apiKey: string, videoIds: string[]): string {
  const params = new URLSearchParams({
    key: apiKey,
    part: "statistics,contentDetails,snippet",
    id: videoIds.join(","),
    maxResults: String(videoIds.length),
  });

  return `${YOUTUBE_VIDEOS_URL}?${params.toString()}`;
}

function toWarningMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "Unknown YouTube video statistics error";
}

export async function fetchYoutubeChannelContext(
  rawInput: FetchYoutubeChannelContextInput,
): Promise<YoutubeChannelContext> {
  const classifyIsShort = rawInput.classifyIsShort ?? defaultClassifyIsShort;
  const input = contextInputSchema.parse(rawInput);
  const channelResponse = await fetch(buildChannelsUrl(input), {
    method: "GET",
  });
  await assertSuccessResponseOrThrow(channelResponse);

  const parsedChannels = parseChannelResponse(await parseJsonResponse(channelResponse));
  const channel = parsedChannels.items[0];

  if (!channel) {
    throw new YoutubeChannelContextProviderError(
      "YOUTUBE_CONTEXT_FAILED",
      404,
      "YouTube channel context not found",
    );
  }

  const uploadsPlaylistId =
    toNullableTrimmed(channel.contentDetails?.relatedPlaylists?.uploads) ?? null;

  const warnings: string[] = [];

  const recentVideos: YoutubeChannelContextDraft["recentVideos"] = [];
  let nextPageToken: string | undefined;
  let shouldContinue = uploadsPlaylistId !== null;

  while (shouldContinue && uploadsPlaylistId !== null && recentVideos.length < input.maxVideos) {
    const remainingVideos = input.maxVideos - recentVideos.length;
    const playlistResponse = await fetch(
      buildPlaylistItemsUrl(
        input.apiKey,
        uploadsPlaylistId,
        Math.min(PLAYLIST_ITEMS_PAGE_SIZE, remainingVideos),
        nextPageToken,
      ),
      {
        method: "GET",
      },
    );
    await assertSuccessResponseOrThrow(playlistResponse);

    const parsedPlaylist = parsePlaylistItemsResponse(await parseJsonResponse(playlistResponse));
    const pageRecentVideos: YoutubeChannelContextDraft["recentVideos"] = parsedPlaylist.items
      .slice(0, remainingVideos)
      .map((item) => ({
        youtubeVideoId: toNullableTrimmed(item.contentDetails?.videoId),
        title: item.snippet.title.trim(),
        description: toNullableTrimmed(item.snippet.description),
        publishedAt: toNullableTrimmed(item.snippet.publishedAt),
        durationSeconds: null,
        isShort: null,
        viewCount: null,
        likeCount: null,
        commentCount: null,
        categoryId: null,
        tags: [],
      }));

    const pageRecentVideoIds = pageRecentVideos
      .map((video) => video.youtubeVideoId)
      .filter((videoId): videoId is string => Boolean(videoId));

    if (pageRecentVideos.length > 0 && pageRecentVideoIds.length === 0) {
      warnings.push("Recent uploads are missing video identifiers; engagement rate cannot be derived.");
    }

    if (pageRecentVideoIds.length > 0) {
      try {
        const videosResponse = await fetch(buildVideosUrl(input.apiKey, pageRecentVideoIds), {
          method: "GET",
        });
        await assertSuccessResponseOrThrow(videosResponse);

        const parsedVideos = parseVideosResponse(await parseJsonResponse(videosResponse));
        const statsByVideoId = new Map(
          parsedVideos.items.map((item) => {
            const durationSeconds = parseDurationToSeconds(item.contentDetails?.duration);

            return [
              item.id,
              {
                durationSeconds,
                isShort: classifyIsShort(durationSeconds),
                viewCount: toNullableNumber(item.statistics?.viewCount),
                likeCount: toNullableNumber(item.statistics?.likeCount),
                commentCount: toNullableNumber(item.statistics?.commentCount),
                categoryId: toNullableTrimmed(item.snippet?.categoryId),
                tags: toTrimmedStringArray(item.snippet?.tags),
              },
            ];
          }),
        );

        pageRecentVideos.forEach((video) => {
          if (!video.youtubeVideoId) {
            return;
          }

          const stats = statsByVideoId.get(video.youtubeVideoId);

          if (!stats) {
            return;
          }

          video.durationSeconds = stats.durationSeconds;
          video.isShort = stats.isShort;
          video.viewCount = stats.viewCount;
          video.likeCount = stats.likeCount;
          video.commentCount = stats.commentCount;
          video.categoryId = stats.categoryId;
          video.tags = stats.tags;
        });
      } catch (error) {
        warnings.push(`Recent video statistics unavailable: ${toWarningMessage(error)}`);
        recentVideos.push(...pageRecentVideos);
        break;
      }
    }

    recentVideos.push(...pageRecentVideos);

    const longFormVideos = recentVideos.filter((video) => video.isShort === false).length;

    if (
      longFormVideos >= input.minLongFormVideos ||
      recentVideos.length >= input.maxVideos ||
      !parsedPlaylist.nextPageToken ||
      pageRecentVideos.length === 0
    ) {
      shouldContinue = false;
      continue;
    }

    nextPageToken = parsedPlaylist.nextPageToken;
  }

  const context: YoutubeChannelContextDraft = {
    youtubeChannelId: channel.id,
    title: channel.snippet.title.trim(),
    handle: toNullableTrimmed(channel.snippet.customUrl),
    description: toNullableTrimmed(channel.snippet.description),
    thumbnailUrl: pickThumbnailUrl(channel.snippet.thumbnails),
    publishedAt: toNullableTrimmed(channel.snippet.publishedAt),
    defaultLanguage: toNullableTrimmed(channel.snippet.defaultLanguage),
    subscriberCount: toNullableNumber(channel.statistics?.subscriberCount),
    viewCount: toNullableNumber(channel.statistics?.viewCount),
    videoCount: toNullableNumber(channel.statistics?.videoCount),
    recentVideos,
    diagnostics: {
      warnings,
    },
  };

  return youtubeChannelContextSchema.parse(context);
}
