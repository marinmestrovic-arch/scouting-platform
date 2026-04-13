import process from "node:process";

import OpenAI from "openai";
import { z } from "zod";

import type { YoutubeChannelContext } from "../youtube/context";

const OPENAI_MODEL_FALLBACK = "gpt-5-nano";

const baseOutputSchema = z.object({
  summary: z.string().trim().min(1),
  topics: z.array(z.string().trim().min(1)).min(1).max(20),
  brandFitNotes: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
});

const structuredProfileSchema = z.object({
  metadata: z.object({
    language: z.string().trim().min(1),
    contentFormats: z
      .array(z.enum(["long_form", "shorts", "live_stream", "podcast", "mixed", "other"]))
      .min(1)
      .max(10),
    sponsorSignals: z.array(z.string().trim().min(1)).max(20),
    geoHints: z.array(z.string().trim().min(1)).max(20),
    uploadCadenceHint: z.string().trim().min(1),
  }),
  niche: z.object({
    primary: z.string().trim().min(1),
    secondary: z.array(z.string().trim().min(1)).max(10),
    confidence: z.number().min(0).max(1),
  }),
  brandSafety: z.object({
    status: z.enum(["safe", "caution", "unsafe"]),
    flags: z.array(z.string().trim().min(1)).max(20),
    rationale: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
  }),
});

const outputSchema = baseOutputSchema.extend({
  structuredProfile: structuredProfileSchema,
});

const inputSchema = z.object({
  channel: z.object({
    youtubeChannelId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    handle: z.string().trim().nullable(),
    description: z.string().trim().nullable(),
  }),
  youtubeContext: z.custom<YoutubeChannelContext>(),
  apiKey: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  client: z.custom<OpenAiClientLike>().optional(),
});

type OpenAiCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  [key: string]: unknown;
};

type OpenAiClientLike = {
  chat: {
    completions: {
      create(input: Record<string, unknown>): Promise<OpenAiCompletionResponse>;
    };
  };
};

export type OpenAiChannelEnrichmentErrorCode =
  | "OPENAI_API_KEY_MISSING"
  | "OPENAI_AUTH_FAILED"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_INVALID_RESPONSE"
  | "OPENAI_ENRICHMENT_FAILED";

export type OpenAiStructuredProfile = z.infer<typeof structuredProfileSchema>;
export type OpenAiChannelEnrichment = z.infer<typeof outputSchema>;
export type StoredOpenAiChannelEnrichment = z.infer<typeof baseOutputSchema> & {
  structuredProfile: OpenAiStructuredProfile | null;
};
export type EnrichChannelWithOpenAiInput = z.input<typeof inputSchema>;
export type EnrichChannelWithOpenAiResult = {
  profile: OpenAiChannelEnrichment;
  rawPayload: Record<string, unknown>;
};

export class OpenAiChannelEnrichmentError extends Error {
  readonly code: OpenAiChannelEnrichmentErrorCode;
  readonly status: number;

  constructor(code: OpenAiChannelEnrichmentErrorCode, status: number, message: string) {
    super(message);
    this.name = "OpenAiChannelEnrichmentError";
    this.code = code;
    this.status = status;
  }
}

export function isOpenAiChannelEnrichmentError(
  error: unknown,
): error is OpenAiChannelEnrichmentError {
  return error instanceof OpenAiChannelEnrichmentError;
}

function getApiKey(override?: string): string {
  const apiKey = override?.trim() || process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new OpenAiChannelEnrichmentError(
      "OPENAI_API_KEY_MISSING",
      500,
      "OPENAI_API_KEY is required for channel enrichment",
    );
  }

  return apiKey;
}

function getClient(apiKey: string, override?: OpenAiClientLike): OpenAiClientLike {
  return override ?? (new OpenAI({ apiKey }) as unknown as OpenAiClientLike);
}

function getModel(override?: string): string {
  return override?.trim() || process.env.OPENAI_MODEL?.trim() || OPENAI_MODEL_FALLBACK;
}

function slimYoutubeContext(ctx: z.output<typeof inputSchema>["youtubeContext"]): {
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  recentVideos: {
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
  }[];
} {
  return {
    youtubeChannelId: ctx.youtubeChannelId,
    title: ctx.title,
    handle: ctx.handle,
    thumbnailUrl: ctx.thumbnailUrl,
    publishedAt: ctx.publishedAt,
    subscriberCount: ctx.subscriberCount,
    viewCount: ctx.viewCount,
    videoCount: ctx.videoCount,
    recentVideos: ctx.recentVideos.slice(0, 5).map((video) => ({
      youtubeVideoId: video.youtubeVideoId,
      title: video.title,
      description: video.description ? video.description.slice(0, 200) : null,
      publishedAt: video.publishedAt,
      durationSeconds: video.durationSeconds ?? null,
      isShort: video.isShort ?? null,
      viewCount: video.viewCount ?? null,
      likeCount: video.likeCount ?? null,
      commentCount: video.commentCount ?? null,
      categoryId: video.categoryId ?? null,
      tags: video.tags.slice(0, 10),
    })),
  };
}

function buildPrompt(input: z.output<typeof inputSchema>): string {
  return JSON.stringify({
    channel: input.channel,
    youtubeContext: slimYoutubeContext(input.youtubeContext),
    instructions: {
      summary:
        "Write a concise summary of the creator's content style, audience, and positioning.",
      topics: "List the main repeatable content topics as short tags.",
      brandFitNotes:
        "Explain the most relevant sponsor/brand fit observations, including constraints if visible.",
      confidence:
        "Return a number from 0 to 1 reflecting confidence in the profile quality from this context.",
      structuredProfile: {
        metadata: {
          language:
            "Infer the dominant audience or creator language as a short machine-readable code or label.",
          contentFormats:
            "Return one or more values from: long_form, shorts, live_stream, podcast, mixed, other.",
          sponsorSignals:
            "List recurring sponsor or monetization signals visible from titles/descriptions if any.",
          geoHints:
            "List geographic market hints such as country, language region, or audience region abbreviations.",
          uploadCadenceHint:
            "Summarize the visible upload cadence as a short label such as daily, weekly, monthly, irregular.",
        },
        niche: {
          primary: "Return the primary niche as a short machine-readable tag.",
          secondary: "Return additional niche tags when strongly supported.",
          confidence:
            "Return a number from 0 to 1 reflecting confidence in the niche classification.",
        },
        brandSafety: {
          status: "Return exactly one of: safe, caution, unsafe.",
          flags:
            "List notable brand-safety flags as short machine-readable tags. Return an empty array if none.",
          rationale:
            "Explain the brand-safety assessment in one concise sentence grounded in the visible content.",
          confidence:
            "Return a number from 0 to 1 reflecting confidence in the brand-safety assessment.",
        },
      },
    },
  });
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }

      return "";
    })
    .join("")
    .trim();

  return text ? text : null;
}

function toRawPayload(response: OpenAiCompletionResponse): Record<string, unknown> {
  return JSON.parse(JSON.stringify(response)) as Record<string, unknown>;
}

function parseOpenAiChannelEnrichmentContent(rawPayload: unknown): unknown {
  const content = extractTextContent(
    (rawPayload as OpenAiCompletionResponse | null | undefined)?.choices?.[0]?.message?.content,
  );

  if (!content) {
    throw new OpenAiChannelEnrichmentError(
      "OPENAI_INVALID_RESPONSE",
      502,
      "OpenAI returned empty enrichment content",
    );
  }

  let parsedContent: unknown;

  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new OpenAiChannelEnrichmentError(
      "OPENAI_INVALID_RESPONSE",
      502,
      "OpenAI returned invalid enrichment JSON",
    );
  }

  return parsedContent;
}

function invalidOutputError(): never {
  throw new OpenAiChannelEnrichmentError(
    "OPENAI_INVALID_RESPONSE",
    502,
    "OpenAI returned invalid enrichment output",
  );
}

export function extractOpenAiChannelEnrichmentProfileFromRawPayload(
  rawPayload: unknown,
): OpenAiChannelEnrichment {
  const parsedContent = parseOpenAiChannelEnrichmentContent(rawPayload);
  const profile = outputSchema.safeParse(parsedContent);

  if (!profile.success) {
    invalidOutputError();
  }

  return profile.data;
}

export function extractStoredOpenAiChannelEnrichmentProfileFromRawPayload(
  rawPayload: unknown,
): StoredOpenAiChannelEnrichment {
  const parsedContent = parseOpenAiChannelEnrichmentContent(rawPayload);
  const currentProfile = outputSchema.safeParse(parsedContent);

  if (currentProfile.success) {
    return currentProfile.data;
  }

  const legacyProfile = baseOutputSchema.safeParse(parsedContent);

  if (!legacyProfile.success) {
    invalidOutputError();
  }

  return {
    ...legacyProfile.data,
    structuredProfile: null,
  };
}

function toProviderError(error: unknown): OpenAiChannelEnrichmentError {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : null;

  if (status === 401 || status === 403) {
    return new OpenAiChannelEnrichmentError(
      "OPENAI_AUTH_FAILED",
      401,
      "OpenAI API key is invalid or unauthorized",
    );
  }

  if (status === 429) {
    return new OpenAiChannelEnrichmentError(
      "OPENAI_RATE_LIMITED",
      429,
      "OpenAI rate limit exceeded",
    );
  }

  return new OpenAiChannelEnrichmentError(
    "OPENAI_ENRICHMENT_FAILED",
    502,
    "OpenAI enrichment request failed",
  );
}

export async function enrichChannelWithOpenAi(
  rawInput: EnrichChannelWithOpenAiInput,
): Promise<EnrichChannelWithOpenAiResult> {
  const input = inputSchema.parse(rawInput);
  const apiKey = getApiKey(input.apiKey);
  const client = getClient(apiKey, input.client);
  const model = getModel(input.model);

  let response: OpenAiCompletionResponse;

  try {
    response = await client.chat.completions.create({
      model,
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content:
            "You analyze creator-channel context and must return valid JSON with summary, topics, brandFitNotes, confidence, and structuredProfile.",
        },
        {
          role: "user",
          content: buildPrompt(input),
        },
      ],
    });
  } catch (error) {
    throw toProviderError(error);
  }

  return {
    profile: extractOpenAiChannelEnrichmentProfileFromRawPayload(response),
    rawPayload: toRawPayload(response),
  };
}
