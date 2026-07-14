import { z } from "zod";

const YOUTUBE_CHANNELS_URL = "https://youtube.googleapis.com/youtube/v3/channels";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;

const batchInputSchema = z.object({
  apiKey: z.string().trim().min(1),
  channelIds: z.array(z.string().trim().min(1)).min(1).max(50),
});

const responseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().trim().min(1),
      snippet: z.object({
        country: z.string().trim().length(2).optional(),
      }),
    }),
  ).default([]),
});

const errorResponseSchema = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }).optional(),
});

const quotaReasons = new Set(["quotaExceeded", "dailyLimitExceeded"]);
const authReasons = new Set(["keyInvalid", "forbidden", "accessNotConfigured", "ipRefererBlocked"]);

export type YoutubeChannelCountryErrorCode =
  | "YOUTUBE_QUOTA_EXCEEDED"
  | "YOUTUBE_AUTH_FAILED"
  | "YOUTUBE_CHANNEL_NOT_FOUND"
  | "YOUTUBE_COUNTRY_FAILED";

export class YoutubeChannelCountryProviderError extends Error {
  constructor(
    readonly code: YoutubeChannelCountryErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "YoutubeChannelCountryProviderError";
  }
}

export function isYoutubeChannelCountryProviderError(
  error: unknown,
): error is YoutubeChannelCountryProviderError {
  return error instanceof YoutubeChannelCountryProviderError;
}

function buildUrl(input: z.output<typeof batchInputSchema>): string {
  const params = new URLSearchParams({
    key: input.apiKey,
    part: "snippet",
    id: input.channelIds.join(","),
    maxResults: String(input.channelIds.length),
    fields: "items(id,snippet(country))",
  });

  return `${YOUTUBE_CHANNELS_URL}?${params.toString()}`;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function getErrorReasons(payload: unknown): Set<string> {
  const parsed = errorResponseSchema.safeParse(payload);

  return new Set(
    (parsed.success ? parsed.data.error?.errors ?? [] : [])
      .map((item) => item.reason?.trim())
      .filter((reason): reason is string => Boolean(reason)),
  );
}

async function requestCountry(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof Error
      && (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new YoutubeChannelCountryProviderError(
        "YOUTUBE_COUNTRY_FAILED",
        504,
        "YouTube channel country request timed out",
      );
    }

    throw error;
  }
}

export async function fetchYoutubeDeclaredCountries(rawInput: {
  apiKey: string;
  channelIds: string[];
}): Promise<Map<string, string | null>> {
  const input = batchInputSchema.parse({
    ...rawInput,
    channelIds: [...new Set(rawInput.channelIds)],
  });
  const url = buildUrl(input);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;

    try {
      response = await requestCountry(url);
    } catch (error) {
      if (error instanceof YoutubeChannelCountryProviderError || attempt === MAX_ATTEMPTS) {
        throw error;
      }

      continue;
    }

    if (!response.ok) {
      const reasons = getErrorReasons(await parseJson(response));

      if ([...reasons].some((reason) => quotaReasons.has(reason))) {
        throw new YoutubeChannelCountryProviderError(
          "YOUTUBE_QUOTA_EXCEEDED",
          429,
          "YouTube API quota exceeded",
        );
      }

      if ([...reasons].some((reason) => authReasons.has(reason))) {
        throw new YoutubeChannelCountryProviderError(
          "YOUTUBE_AUTH_FAILED",
          401,
          "YouTube API key is invalid or unauthorized",
        );
      }

      if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
        continue;
      }

      throw new YoutubeChannelCountryProviderError(
        "YOUTUBE_COUNTRY_FAILED",
        502,
        "YouTube channel country request failed",
      );
    }

    const parsed = responseSchema.safeParse(await parseJson(response));

    if (!parsed.success) {
      throw new YoutubeChannelCountryProviderError(
        "YOUTUBE_COUNTRY_FAILED",
        502,
        "YouTube returned an invalid channel country response",
      );
    }

    return new Map(parsed.data.items.map((channel) => [
      channel.id,
      channel.snippet.country?.toUpperCase() ?? null,
    ]));
  }

  throw new YoutubeChannelCountryProviderError(
    "YOUTUBE_COUNTRY_FAILED",
    502,
    "YouTube channel country request failed",
  );
}

export async function fetchYoutubeDeclaredCountry(rawInput: {
  apiKey: string;
  channelId: string;
}): Promise<{ countryCode: string | null }> {
  const countries = await fetchYoutubeDeclaredCountries({
    apiKey: rawInput.apiKey,
    channelIds: [rawInput.channelId],
  });

  if (!countries.has(rawInput.channelId)) {
    throw new YoutubeChannelCountryProviderError(
      "YOUTUBE_CHANNEL_NOT_FOUND",
      404,
      "YouTube channel not found",
    );
  }

  return { countryCode: countries.get(rawInput.channelId) ?? null };
}
