import { z } from "zod";

const contextInputSchema = z.object({
  apiKey: z.string().trim().min(1),
  channelId: z.string().trim().min(1),
  maxVideos: z.number().int().min(1).max(10).default(10),
});

const channelResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().trim().min(1),
      snippet: z.object({
        title: z.string(),
        description: z.string().optional(),
        customUrl: z.string().optional(),
        publishedAt: z.string().optional(),
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
  ),
});

const playlistItemsResponseSchema = z.object({
  items: z.array(
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
  ),
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
  subscriberCount: z.number().nullable(),
  viewCount: z.number().nullable(),
  videoCount: z.number().nullable(),
  recentVideos: z.array(
    z.object({
      youtubeVideoId: z.string().trim().nullable(),
      title: z.string().trim().min(1),
      description: z.string().trim().nullable(),
      publishedAt: z.string().trim().nullable(),
    }),
  ),
});

export type YoutubeChannelContext = z.infer<typeof youtubeChannelContextSchema>;

type YoutubeChannelContextDraft = {
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  recentVideos: Array<{
    youtubeVideoId: string | null;
    title: string;
    description: string | null;
    publishedAt: string | null;
  }>;
};

export type FetchYoutubeChannelContextInput = z.input<typeof contextInputSchema>;

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

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
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

function buildPlaylistItemsUrl(apiKey: string, uploadsPlaylistId: string, maxVideos: number): string {
  const params = new URLSearchParams({
    key: apiKey,
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(maxVideos),
  });

  return `${YOUTUBE_PLAYLIST_ITEMS_URL}?${params.toString()}`;
}

export async function fetchYoutubeChannelContext(
  rawInput: FetchYoutubeChannelContextInput,
): Promise<YoutubeChannelContext> {
  const input = contextInputSchema.parse(rawInput);
  const channelResponse = await fetch(buildChannelsUrl(input), {
    method: "GET",
  });
  await assertSuccessResponseOrThrow(channelResponse);

  const parsedChannels = channelResponseSchema.parse(await parseJsonResponse(channelResponse));
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

  const recentVideos =
    uploadsPlaylistId === null
      ? []
      : await (async () => {
          const playlistResponse = await fetch(
            buildPlaylistItemsUrl(input.apiKey, uploadsPlaylistId, input.maxVideos),
            {
              method: "GET",
            },
          );
          await assertSuccessResponseOrThrow(playlistResponse);

          const parsedPlaylist = playlistItemsResponseSchema.parse(
            await parseJsonResponse(playlistResponse),
          );

          return parsedPlaylist.items.map((item) => ({
            youtubeVideoId: toNullableTrimmed(item.contentDetails?.videoId),
            title: item.snippet.title.trim(),
            description: toNullableTrimmed(item.snippet.description),
            publishedAt: toNullableTrimmed(item.snippet.publishedAt),
          }));
        })();

  const context: YoutubeChannelContextDraft = {
    youtubeChannelId: channel.id,
    title: channel.snippet.title.trim(),
    handle: toNullableTrimmed(channel.snippet.customUrl),
    description: toNullableTrimmed(channel.snippet.description),
    thumbnailUrl: pickThumbnailUrl(channel.snippet.thumbnails),
    publishedAt: toNullableTrimmed(channel.snippet.publishedAt),
    subscriberCount: toNullableNumber(channel.statistics?.subscriberCount),
    viewCount: toNullableNumber(channel.statistics?.viewCount),
    videoCount: toNullableNumber(channel.statistics?.videoCount),
    recentVideos,
  };

  return youtubeChannelContextSchema.parse(context);
}
