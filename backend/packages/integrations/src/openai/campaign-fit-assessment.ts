import process from "node:process";

import OpenAI from "openai";
import { z } from "zod";

import type { YoutubeChannelContext } from "../youtube/context";

const OPENAI_MODEL = "gpt-4.1-mini" as const;
const MAX_FIT_REASONS = 10;
const MAX_ASSESSMENT_BULLET_LENGTH = 80;

const rawOutputSchema = z.object({
  fitScore: z.number().min(0).max(1),
  fitReasons: z.array(z.string().trim().min(1)).min(1).max(10),
  fitConcerns: z.array(z.string().trim().min(1)).max(10),
  recommendedAngles: z.array(z.string().trim().min(1)).max(10),
  avoidTopics: z.array(z.string().trim().min(1)).max(10),
});

export type OpenAiCampaignFitAssessment = z.infer<typeof rawOutputSchema>;

const campaignBriefSchema = z.object({
  client: z.string().nullable(),
  campaignName: z.string().nullable(),
  clientIndustry: z.string().nullable(),
  campaignObjective: z.string().nullable(),
  targetAudienceAge: z.string().nullable(),
  targetAudienceGender: z.string().nullable(),
  targetGeographies: z.array(z.string()).nullable(),
  contentRestrictions: z.array(z.string()).nullable(),
  budgetTier: z.string().nullable(),
  deliverables: z.array(z.string()).nullable(),
});

const inputSchema = z.object({
  channel: z.object({
    youtubeChannelId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    handle: z.string().trim().nullable(),
    description: z.string().trim().nullable(),
  }),
  youtubeContext: z.custom<YoutubeChannelContext>(),
  enrichmentProfile: z
    .object({
      summary: z.string(),
      topics: z.array(z.string()),
      brandFitNotes: z.string(),
      structuredProfile: z.unknown().nullable().optional(),
    })
    .nullable(),
  campaignBrief: campaignBriefSchema,
  apiKey: z.string().trim().min(1).optional(),
  client: z.custom<OpenAiClientLike>().optional(),
});

export type EnrichCampaignFitInput = z.input<typeof inputSchema>;

type OpenAiCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  [key: string]: unknown;
};

export interface OpenAiClientLike {
  chat: {
    completions: {
      create(input: Record<string, unknown>): Promise<OpenAiCompletionResponse>;
    };
  };
}

export type OpenAiCampaignFitErrorCode =
  | "OPENAI_API_KEY_MISSING"
  | "OPENAI_AUTH_FAILED"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_INVALID_RESPONSE"
  | "OPENAI_CAMPAIGN_FIT_FAILED";

export class OpenAiCampaignFitError extends Error {
  readonly code: OpenAiCampaignFitErrorCode;
  readonly status: number;

  constructor(code: OpenAiCampaignFitErrorCode, message: string, status: number) {
    super(message);
    this.name = "OpenAiCampaignFitError";
    this.code = code;
    this.status = status;
  }
}

export function isOpenAiCampaignFitError(error: unknown): error is OpenAiCampaignFitError {
  return error instanceof OpenAiCampaignFitError;
}

function getApiKey(inputKey: string | undefined): string {
  const fromInput = inputKey?.trim();

  if (fromInput) {
    return fromInput;
  }

  const fromEnv = process.env.OPENAI_API_KEY?.trim();

  if (fromEnv) {
    return fromEnv;
  }

  throw new OpenAiCampaignFitError(
    "OPENAI_API_KEY_MISSING",
    "OpenAI API key not configured",
    500,
  );
}

function getClient(apiKey: string, override?: OpenAiClientLike): OpenAiClientLike {
  return override ?? (new OpenAI({ apiKey }) as unknown as OpenAiClientLike);
}

function slimYoutubeContext(ctx: YoutubeChannelContext): {
  youtubeChannelId: string;
  title: string;
  customUrl?: string;
  country?: string;
  defaultLanguage: string | null;
  publishedAt: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  recentVideos: Array<{
    videoId: string | null;
    title: string;
    description: string | null;
    publishedAt: string | null;
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
  }>;
} {
  return {
    youtubeChannelId: ctx.youtubeChannelId,
    title: ctx.title,
    defaultLanguage: ctx.defaultLanguage,
    publishedAt: ctx.publishedAt,
    subscriberCount: ctx.subscriberCount,
    viewCount: ctx.viewCount,
    videoCount: ctx.videoCount,
    recentVideos: (ctx.recentVideos ?? []).slice(0, 5).map((video) => ({
      videoId: video.youtubeVideoId,
      title: video.title,
      description: video.description?.slice(0, 200) ?? null,
      publishedAt: video.publishedAt,
      viewCount: video.viewCount ?? null,
      likeCount: video.likeCount ?? null,
      commentCount: video.commentCount ?? null,
    })),
  };
}

function buildPrompt(input: z.output<typeof inputSchema>): string {
  return JSON.stringify({
    freeTextBrief: input.campaignBrief.campaignObjective,
    campaignBrief: input.campaignBrief,
    channel: input.channel,
    youtubeContext: slimYoutubeContext(input.youtubeContext),
    enrichmentProfile: input.enrichmentProfile,
    classificationSource:
      "enrichmentProfile is the prior nano creator classification. Use it as the primary classification signal, then use YouTube context and the campaign brief to judge fit.",
    briefUsage:
      "freeTextBrief is the campaign manager's free-text description of the requested category, niche, audience, creator style, and constraints. Treat it as the primary campaign-specific relevance signal after the hard filters have already selected candidate channels.",
    instructions: {
      fitScore:
        "Return a number from 0 to 1 scoring how well this creator fits THIS specific free-text brief. 0 = clearly wrong fit, 1 = perfect fit. Weight: category and niche alignment, audience match, content style alignment, brand safety for this client's industry, presence of campaign-required themes.",
      brevity:
        "Be extremely concise. The UI shows this as short bullets inside a scouting-result card, not a report. Each bullet should be a terse signal under 80 characters, often 2-7 words.",
      fitReasons:
        "List every useful fit signal, up to 10. Use short fragments like 'Publishes weekly', 'French-speaking audience', '2.27M subscribers', or 'Past sponsors: CarVertical, HelloFresh'. Include past sponsorship/brand partnership evidence whenever the channel context shows it.",
      fitConcerns:
        "Return an empty array. Concerns are not shown in this UI.",
      recommendedAngles:
        "Return an empty array. Recommended angles are not shown in this UI.",
      avoidTopics:
        "Return an empty array. Topics to avoid are not shown in this UI.",
    },
  });
}

function compactAssessmentBullet(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= MAX_ASSESSMENT_BULLET_LENGTH) {
    return normalized;
  }

  const firstSentence = normalized.match(/^.{1,80}[.!?](?=\s|$)/)?.[0];

  if (firstSentence) {
    return firstSentence;
  }

  const cutoff = normalized.lastIndexOf(" ", MAX_ASSESSMENT_BULLET_LENGTH - 3);
  const end = cutoff > 40 ? cutoff : MAX_ASSESSMENT_BULLET_LENGTH - 3;

  return `${normalized.slice(0, end).trimEnd()}...`;
}

function compactAssessmentItems(items: string[], limit: number): string[] {
  return items
    .map(compactAssessmentBullet)
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

function compactAssessmentOutput(
  output: z.infer<typeof rawOutputSchema>,
): OpenAiCampaignFitAssessment {
  return {
    fitScore: output.fitScore,
    fitReasons: compactAssessmentItems(output.fitReasons, MAX_FIT_REASONS),
    fitConcerns: [],
    recommendedAngles: [],
    avoidTopics: [],
  };
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

function toProviderError(error: unknown): OpenAiCampaignFitError {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : null;
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "OpenAI request failed";

  if (status === 401 || status === 403) {
    return new OpenAiCampaignFitError("OPENAI_AUTH_FAILED", message, status);
  }

  if (status === 429) {
    return new OpenAiCampaignFitError("OPENAI_RATE_LIMITED", message, 429);
  }

  return new OpenAiCampaignFitError(
    "OPENAI_CAMPAIGN_FIT_FAILED",
    message,
    status ?? 500,
  );
}

export function extractOpenAiCampaignFitFromRawPayload(
  rawPayload: unknown,
): OpenAiCampaignFitAssessment {
  const content = extractTextContent(
    (rawPayload as OpenAiCompletionResponse | null | undefined)?.choices?.[0]?.message?.content,
  );

  if (!content) {
    throw new OpenAiCampaignFitError(
      "OPENAI_INVALID_RESPONSE",
      "OpenAI response missing content",
      502,
    );
  }

  let parsedContent: unknown;

  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new OpenAiCampaignFitError(
      "OPENAI_INVALID_RESPONSE",
      "OpenAI response was not valid JSON",
      502,
    );
  }

  const parsed = rawOutputSchema.safeParse(parsedContent);

  if (!parsed.success) {
    throw new OpenAiCampaignFitError(
      "OPENAI_INVALID_RESPONSE",
      `OpenAI response failed schema validation: ${parsed.error.message}`,
      502,
    );
  }

  return compactAssessmentOutput(parsed.data);
}

export type EnrichCampaignFitResult = {
  profile: OpenAiCampaignFitAssessment;
  rawPayload: Record<string, unknown>;
  model: typeof OPENAI_MODEL;
};

export async function enrichCampaignFitWithOpenAi(
  rawInput: EnrichCampaignFitInput,
): Promise<EnrichCampaignFitResult> {
  const input = inputSchema.parse(rawInput);
  const apiKey = getApiKey(input.apiKey);
  const client = getClient(apiKey, input.client);

  let response: OpenAiCompletionResponse;

  try {
    response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content:
            "You assess a YouTube creator's fit for a specific marketing campaign free-text brief after hard filters have already selected candidate channels. Return concise valid JSON with fitScore, fitReasons, fitConcerns, recommendedAngles, and avoidTopics. Keep fitReasons as short signal bullets; return empty arrays for fitConcerns, recommendedAngles, and avoidTopics.",
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
    profile: extractOpenAiCampaignFitFromRawPayload(response),
    rawPayload: toRawPayload(response),
    model: OPENAI_MODEL,
  };
}
