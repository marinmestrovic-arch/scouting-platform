import {
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
  CredentialProvider,
  Prisma,
} from "@prisma/client";
import type { RequestChannelEnrichmentResponse } from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import {
  extractStoredOpenAiChannelEnrichmentProfileFromRawPayload,
  enrichChannelWithOpenAi,
  enrichCreatorProfilesWithOpenAi,
  fetchYoutubeChannelContext,
  fetchYoutubeChannelPageEmailSignal,
  isOpenAiChannelEnrichmentError,
  type StoredOpenAiChannelEnrichment,
  type YoutubeChannelContext,
  type YoutubeChannelPageEmailSignal,
  isYoutubeChannelContextProviderError,
  youtubeChannelContextSchema,
} from "@scouting-platform/integrations";

import { getUserYoutubeApiKey } from "../auth";
import { getChannelById } from "../channels";
import { listDropdownOptions } from "../dropdown-values";
import { ServiceError } from "../errors";
import { mapYoutubeLanguageToHubspot } from "../hubspot/language-mapping";
import { inferVerticalsForHubspot } from "../hubspot/vertical-inference";
import { enqueueJob } from "../queue";
import { logProviderSpend } from "../telemetry";
import { deriveChannelClassificationSignals } from "./classification-signals";
import { markChannelLlmEnrichmentFailed } from "./continuous";
import {
  deriveCreatorListYoutubeMetrics,
  deriveYoutubeMetrics,
  isYoutubeShortVideo,
  normalizeYoutubeContext,
} from "./metrics";
import {
  isYoutubeContextFresh,
  resolveChannelEnrichmentStatus,
} from "./status";

type ChannelYoutubeContextCacheRow = {
  context: Prisma.JsonValue | null;
  fetchedAt: Date | null;
  lastError: string | null;
};

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toNullableBigInt(value: number | null): bigint | null {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return BigInt(Math.round(value));
}

const CHANNEL_PROFILE_RESULT_FIELD_BY_KEY = {
  email: "Email",
  influencerType: "Influencer Type",
  influencerVertical: "Influencer Vertical",
  countryRegion: "Country/Region",
  language: "Language",
} as const;

type ChannelProfileFieldKey = keyof typeof CHANNEL_PROFILE_RESULT_FIELD_BY_KEY;
type DropdownOptions = Awaited<ReturnType<typeof listDropdownOptions>>;
type DropdownUpdate =
  | { op: "set"; value: string }
  | { op: "clear" };

function normalizeExtractedEmailCandidate(value: string): string {
  return value
    .replace(/^mailto:/iu, "")
    .replace(/^[<("'`[]+/, "")
    .replace(/[>"')\],;:!?]+$/, "")
    .trim()
    .toLowerCase();
}

function extractExplicitEmailsFromText(value: string): string[] {
  const raw = value.trim();

  if (!raw) {
    return [];
  }

  const results: string[] = [];
  const seen = new Set<string>();

  function collectFromText(text: string): void {
    const pattern =
      /(?:mailto:)?([A-Z0-9.!#$%&'*+=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,63})/giu;

    for (const match of text.matchAll(pattern)) {
      const email = normalizeExtractedEmailCandidate(match[1] ?? match[0] ?? "");

      if (!email || seen.has(email)) {
        continue;
      }

      seen.add(email);
      results.push(email);
    }
  }

  const decodedHtml = raw
    .replace(/&commat;|&#64;|&#x40;/giu, "@")
    .replace(/&period;|&#46;|&#x2e;/giu, ".");

  collectFromText(decodedHtml);

  const deobfuscated = decodedHtml
    .replace(/\s*\[\s*at\s*\]\s*/giu, "@")
    .replace(/\s*\(\s*at\s*\)\s*/giu, "@")
    .replace(/\s+\bat\b\s+/giu, "@")
    .replace(/\s*\[\s*dot\s*\]\s*/giu, ".")
    .replace(/\s*\(\s*dot\s*\)\s*/giu, ".")
    .replace(/\s+\bdot\b\s+/giu, ".");

  if (deobfuscated !== decodedHtml) {
    collectFromText(deobfuscated);
  }

  return results;
}

function extractExplicitEmailsFromTextList(values: readonly string[]): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    for (const email of extractExplicitEmailsFromText(value)) {
      if (seen.has(email)) {
        continue;
      }

      seen.add(email);
      results.push(email);
    }
  }

  return results;
}

function getPageSignalTextValues(
  pageSignal: YoutubeChannelPageEmailSignal | null | undefined,
): string[] {
  if (!pageSignal) {
    return [];
  }

  return [
    ...pageSignal.emails,
    pageSignal.snippet ?? "",
  ].filter((value) => value.trim().length > 0);
}

function getPreferredCreatorEmail(
  context: YoutubeChannelContext,
  pageSignal: YoutubeChannelPageEmailSignal | null,
): string {
  const bioEmail = extractExplicitEmailsFromText(context.description ?? "")[0] ?? "";

  if (bioEmail) {
    return bioEmail;
  }

  const pageEmail = extractExplicitEmailsFromTextList(getPageSignalTextValues(pageSignal))[0] ?? "";

  if (pageEmail) {
    return pageEmail;
  }

  return extractExplicitEmailsFromTextList(
    context.recentVideos.map((video) => video.description ?? ""),
  )[0] ?? "";
}

function getCountryNameFromRegionCode(value: string): string | null {
  const code = value.trim();

  if (!/^[a-z]{2}$/iu.test(code)) {
    return null;
  }

  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

function normalizeDropdownComparable(value: string): string {
  const countryName = getCountryNameFromRegionCode(value);
  const normalizedValue = countryName ?? value;

  return normalizedValue
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/gu, " and ")
    .replace(/\busa\b/giu, "united states")
    .replace(/\bu\.s\.a\.\b/giu, "united states")
    .replace(/\buk\b/giu, "united kingdom")
    .replace(/\bu\.k\.\b/giu, "united kingdom")
    .replace(/\buae\b/giu, "united arab emirates")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ");
}

function normalizeDropdownTokenSet(value: string): string {
  return normalizeDropdownComparable(value)
    .split(" ")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .join(" ");
}

function coerceDropdownOption(options: readonly string[], value: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return "";
  }

  const exact = options.find((option) => option === normalizedValue);

  if (exact) {
    return exact;
  }

  const caseInsensitive = options.find(
    (option) => option.trim().toLowerCase() === normalizedValue.toLowerCase(),
  );

  if (caseInsensitive) {
    return caseInsensitive;
  }

  if (normalizedValue === "English (US)" || normalizedValue === "English (UK)") {
    return coerceDropdownOption(options, "English");
  }

  const comparableValue = normalizeDropdownComparable(normalizedValue);
  const normalized = options.find(
    (option) => normalizeDropdownComparable(option) === comparableValue,
  );

  if (normalized) {
    return normalized;
  }

  const tokenSetValue = normalizeDropdownTokenSet(normalizedValue);
  const tokenSet = options.find(
    (option) => normalizeDropdownTokenSet(option) === tokenSetValue,
  );

  if (tokenSet) {
    return tokenSet;
  }

  const partialMatches = options.filter((option) => {
    const comparableOption = normalizeDropdownComparable(option);

    return (
      comparableValue.length >= 3
      && (comparableOption.includes(comparableValue) || comparableValue.includes(comparableOption))
    );
  });

  return partialMatches.length === 1 ? partialMatches[0] ?? "" : "";
}

function coerceFirstDropdownOption(options: readonly string[], value: string): string {
  for (const item of value.split(/[;,|]/u)) {
    const coerced = coerceDropdownOption(options, item);

    if (coerced) {
      return coerced;
    }
  }

  return "";
}

function getProfileResultValue(
  result: Record<string, string> | undefined,
  field: ChannelProfileFieldKey,
): string {
  return result?.[CHANNEL_PROFILE_RESULT_FIELD_BY_KEY[field]]?.trim() ?? "";
}

function resolveDropdownUpdate(input: {
  currentValue: string | null | undefined;
  options: readonly string[];
  candidates: readonly string[];
}): DropdownUpdate | null {
  if (input.options.length === 0) {
    return null;
  }

  const currentValue = input.currentValue?.trim() ?? "";
  const normalizedCurrent = coerceFirstDropdownOption(input.options, currentValue);

  if (currentValue && normalizedCurrent === currentValue) {
    return null;
  }

  if (normalizedCurrent) {
    return { op: "set", value: normalizedCurrent };
  }

  for (const candidate of input.candidates) {
    const coerced = coerceFirstDropdownOption(input.options, candidate);

    if (coerced) {
      return { op: "set", value: coerced };
    }
  }

  return currentValue ? { op: "clear" } : null;
}

function applyDropdownUpdate(
  update: DropdownUpdate | null,
): string | null | undefined {
  if (!update) {
    return undefined;
  }

  return update.op === "set" ? update.value : null;
}

function buildChannelCreatorProfileContextText(input: {
  channel: {
    title: string;
    youtubeChannelId: string;
    handle: string | null;
    youtubeUrl: string | null;
    description: string | null;
  };
  youtubeContext: YoutubeChannelContext;
  pageSignal: YoutubeChannelPageEmailSignal | null;
}): string {
  const contextFields: Array<[string, string]> = [
    ["Channel Name", input.channel.title],
    ["YouTube Handle", input.youtubeContext.handle ?? input.channel.handle ?? ""],
    [
      "YouTube URL",
      input.channel.youtubeUrl
        ?? (input.youtubeContext.handle
          ? `https://www.youtube.com/${input.youtubeContext.handle.startsWith("@") ? input.youtubeContext.handle : `@${input.youtubeContext.handle}`}`
          : `https://www.youtube.com/channel/${input.channel.youtubeChannelId}`),
    ],
    ["Channel Description", input.channel.description ?? input.youtubeContext.description ?? ""],
    ["Resolved YouTube Language", input.youtubeContext.defaultLanguage ?? ""],
  ];
  const lines = contextFields.flatMap(([label, value]) =>
    value.trim() ? [`${label}: ${value.trim()}`] : []);

  const pageEmails = extractExplicitEmailsFromTextList(getPageSignalTextValues(input.pageSignal));

  if (pageEmails.length > 0) {
    lines.push(`Explicit Emails From Channel Page: ${pageEmails.join(" | ")}`);
  }

  if (input.pageSignal?.snippet) {
    lines.push(`Channel Page/About Snippet: ${input.pageSignal.snippet}`);
  }

  const categoryNames = Array.from(
    new Set(
      input.youtubeContext.recentVideos
        .map((video) => video.categoryName ?? "")
        .filter((categoryName) => categoryName.trim().length > 0),
    ),
  );

  if (categoryNames.length > 0) {
    lines.push(`Resolved YouTube Categories: ${categoryNames.slice(0, 5).join(" | ")}`);
  }

  const sampledTitles = input.youtubeContext.recentVideos
    .map((video) => video.title)
    .filter((title) => title.trim().length > 0)
    .slice(0, 10);

  if (sampledTitles.length > 0) {
    lines.push(`Sampled Video Titles: ${sampledTitles.join(" | ")}`);
  }

  const sampledDescriptions = input.youtubeContext.recentVideos
    .map((video) => video.description ?? "")
    .filter((description) => description.trim().length > 0)
    .slice(0, 3)
    .map((description) => description.slice(0, 280));

  if (sampledDescriptions.length > 0) {
    lines.push(`Sampled Video Descriptions: ${sampledDescriptions.join(" || ")}`);
  }

  return lines.join("\n");
}

async function fetchChannelPageSignalBestEffort(
  canonicalUrl: string,
): Promise<YoutubeChannelPageEmailSignal | null> {
  try {
    const signal = await fetchYoutubeChannelPageEmailSignal({
      canonicalUrl,
    });

    return signal.emails.length > 0 || signal.snippet ? signal : null;
  } catch {
    return null;
  }
}

async function enrichChannelCreatorProfileFieldsBestEffort(input: {
  channel: {
    id: string;
    title: string;
    youtubeChannelId: string;
    handle: string | null;
    youtubeUrl: string | null;
    description: string | null;
    influencerType: string | null;
    influencerVertical: string | null;
    countryRegion: string | null;
    contentLanguage: string | null;
    contacts: Array<{ email: string }>;
  };
  youtubeContext: YoutubeChannelContext;
  pageSignal: YoutubeChannelPageEmailSignal | null;
  dropdownOptions: DropdownOptions;
}): Promise<Record<string, string>> {
  const requestedFields = (
    [
      "email",
      "influencerType",
      "influencerVertical",
      "countryRegion",
      "language",
    ] as const
  ).filter((field) => {
    if (field === "email") {
      return input.channel.contacts.length === 0;
    }

    const options = input.dropdownOptions[field];
    const currentValue = field === "language"
      ? input.channel.contentLanguage
      : input.channel[field];

    return Boolean(resolveDropdownUpdate({
      currentValue,
      options,
      candidates: [],
    }));
  }).map((field) => CHANNEL_PROFILE_RESULT_FIELD_BY_KEY[field]);

  if (requestedFields.length === 0) {
    return {};
  }

  try {
    const [result] = await enrichCreatorProfilesWithOpenAi({
      requests: [
        {
          rowKey: input.channel.id,
          channelName: input.channel.title,
          channelUrl: input.channel.youtubeUrl ?? "",
          campaignName: "",
          requestedFields,
          contextText: buildChannelCreatorProfileContextText({
            channel: input.channel,
            youtubeContext: input.youtubeContext,
            pageSignal: input.pageSignal,
          }),
        },
      ],
      dropdownOptions: {
        "Influencer Type": input.dropdownOptions.influencerType,
        "Influencer Vertical": input.dropdownOptions.influencerVertical,
        "Country/Region": input.dropdownOptions.countryRegion,
        Language: input.dropdownOptions.language,
      },
    });

    return result?.values ?? {};
  } catch {
    return {};
  }
}

function getCachedYoutubeContext(row: ChannelYoutubeContextCacheRow | null) {
  if (!row?.context) {
    return null;
  }

  const parsed = youtubeChannelContextSchema.safeParse(row.context);
  return parsed.success ? parsed.data : null;
}

function extractProfileFromRawPayload(
  raw: Prisma.JsonValue,
): StoredOpenAiChannelEnrichment {
  try {
    return extractStoredOpenAiChannelEnrichmentProfileFromRawPayload(raw);
  } catch {
    throw new ServiceError(
      "OPENAI_INVALID_STORED_PAYLOAD",
      500,
      "Stored OpenAI payload is invalid",
    );
  }
}

function extractTokenUsage(
  rawPayload: unknown,
): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
  if (!rawPayload || typeof rawPayload !== "object") {
    return undefined;
  }

  const usage = (rawPayload as Record<string, unknown>).usage;

  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const u = usage as Record<string, unknown>;
  const prompt = Number(u.prompt_tokens);
  const completion = Number(u.completion_tokens);
  const total = Number(u.total_tokens);

  if (!Number.isFinite(prompt)) {
    return undefined;
  }

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
  };
}

async function refreshYoutubeContext(input: {
  channelId: string;
  youtubeChannelId: string;
  youtubeApiKey: string;
  cachedContextRow: ChannelYoutubeContextCacheRow | null;
}) {
  const cachedContext = getCachedYoutubeContext(input.cachedContextRow);

  if (
    cachedContext &&
    isYoutubeContextFresh({
      fetchedAt: input.cachedContextRow?.fetchedAt,
    })
  ) {
    return cachedContext;
  }

  try {
    const context = normalizeYoutubeContext(await fetchYoutubeChannelContext({
      apiKey: input.youtubeApiKey,
      channelId: input.youtubeChannelId,
      maxVideos: 50,
      minLongFormVideos: 12,
      classifyIsShort: isYoutubeShortVideo,
    }));
    const fetchedAt = new Date();

    await prisma.channelYoutubeContext.upsert({
      where: {
        channelId: input.channelId,
      },
      create: {
        channelId: input.channelId,
        context: toJsonValue(context),
        fetchedAt,
        lastError: null,
      },
      update: {
        context: toJsonValue(context),
        fetchedAt,
        lastError: null,
      },
    });

    return context;
  } catch (error) {
    const lastError = formatErrorMessage(error);

    await prisma.channelYoutubeContext.upsert({
      where: {
        channelId: input.channelId,
      },
      create: {
        channelId: input.channelId,
        context: input.cachedContextRow?.context
          ? (input.cachedContextRow.context as Prisma.InputJsonValue)
          : Prisma.DbNull,
        fetchedAt: input.cachedContextRow?.fetchedAt ?? null,
        lastError,
      },
      update: {
        lastError,
      },
    });

    throw error;
  }
}

export async function requestChannelLlmEnrichment(input: {
  channelId: string;
  requestedByUserId: string;
}): Promise<RequestChannelEnrichmentResponse> {
  const requestedAt = new Date();
  let shouldEnqueue = false;

  await withDbTransaction(async (tx) => {
    const channel = await tx.channel.findUnique({
      where: {
        id: input.channelId,
      },
      select: {
        updatedAt: true,
        enrichment: {
          select: {
            status: true,
            completedAt: true,
            lastEnrichedAt: true,
          },
        },
      },
    });

    if (!channel) {
      throw new ServiceError("CHANNEL_NOT_FOUND", 404, "Channel not found");
    }

    const hasYoutubeKey = await tx.userProviderCredential.findUnique({
      where: {
        userId_provider: {
          userId: input.requestedByUserId,
          provider: CredentialProvider.YOUTUBE_DATA_API,
        },
      },
      select: {
        id: true,
      },
    });

    if (!hasYoutubeKey) {
      throw new ServiceError(
        "YOUTUBE_KEY_REQUIRED",
        400,
        "Assigned YouTube API key is required before requesting enrichment",
      );
    }

    const previousStatus = resolveChannelEnrichmentStatus({
      channelUpdatedAt: channel.updatedAt,
      enrichment: channel.enrichment,
    });

    if (
      channel.enrichment?.status === PrismaChannelEnrichmentStatus.QUEUED ||
      channel.enrichment?.status === PrismaChannelEnrichmentStatus.RUNNING
    ) {
      shouldEnqueue = false;
    } else if (channel.enrichment) {
      shouldEnqueue = true;

      await tx.channelEnrichment.update({
        where: {
          channelId: input.channelId,
        },
        data: {
          status: PrismaChannelEnrichmentStatus.QUEUED,
          requestedByUserId: input.requestedByUserId,
          requestedAt,
          startedAt: null,
          retryCount: 0,
          nextRetryAt: null,
          lastError: null,
          youtubeFetchedAt: null,
          rawOpenaiPayloadFetchedAt: null,
        },
      });
    } else {
      shouldEnqueue = true;

      await tx.channelEnrichment.create({
        data: {
          channelId: input.channelId,
          status: PrismaChannelEnrichmentStatus.QUEUED,
          requestedByUserId: input.requestedByUserId,
          requestedAt,
          retryCount: 0,
          nextRetryAt: null,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "channel.enrichment.requested",
        entityType: "channel",
        entityId: input.channelId,
        metadata: {
          previousStatus,
          queued: shouldEnqueue,
        },
      },
    });
  });

  if (shouldEnqueue) {
    try {
      await enqueueJob("channels.enrich.llm", {
        channelId: input.channelId,
        requestedByUserId: input.requestedByUserId,
      });
    } catch (error) {
      await markChannelLlmEnrichmentFailed({
        channelId: input.channelId,
        error,
      });

      throw new ServiceError(
        "CHANNEL_ENRICHMENT_ENQUEUE_FAILED",
        500,
        "Failed to enqueue channel enrichment job",
      );
    }
  }

  const channel = await getChannelById(input.channelId);

  if (!channel) {
    throw new ServiceError("CHANNEL_NOT_FOUND", 404, "Channel not found");
  }

  return {
    channelId: input.channelId,
    enrichment: channel.enrichment,
  };
}

export async function executeChannelLlmEnrichment(input: {
  channelId: string;
  requestedByUserId: string;
}): Promise<void> {
  const startedAt = new Date();
  const enrichment = await prisma.channelEnrichment.findUnique({
    where: {
      channelId: input.channelId,
    },
    select: {
      channelId: true,
      requestedByUserId: true,
    },
  });

  if (!enrichment) {
    return;
  }

  const claimed = await prisma.channelEnrichment.updateMany({
    where: {
      channelId: input.channelId,
      status: {
        in: [
          PrismaChannelEnrichmentStatus.QUEUED,
          PrismaChannelEnrichmentStatus.STALE,
        ],
      },
    },
    data: {
      status: PrismaChannelEnrichmentStatus.RUNNING,
      startedAt,
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  try {
    const executionState = await prisma.channelEnrichment.findUnique({
      where: {
        channelId: input.channelId,
      },
      select: {
        channelId: true,
        requestedByUserId: true,
        rawOpenaiPayload: true,
        rawOpenaiPayloadFetchedAt: true,
        youtubeFetchedAt: true,
        channel: {
          select: {
            id: true,
            youtubeChannelId: true,
            title: true,
            handle: true,
            youtubeUrl: true,
            description: true,
            influencerType: true,
            influencerVertical: true,
            countryRegion: true,
            contentLanguage: true,
            contacts: {
              orderBy: {
                email: "asc",
              },
              select: {
                email: true,
              },
            },
            youtubeContext: {
              select: {
                context: true,
                fetchedAt: true,
                lastError: true,
              },
            },
          },
        },
      },
    });

    if (!executionState) {
      return;
    }

    const youtubeApiKey = await getUserYoutubeApiKey(executionState.requestedByUserId);

    if (!youtubeApiKey) {
      throw new ServiceError(
        "YOUTUBE_KEY_REQUIRED",
        400,
        "Assigned YouTube API key is required before executing enrichment",
      );
    }

    let youtubeContext: YoutubeChannelContext;
    const youtubeRetryAttempt = executionState.youtubeFetchedAt !== null;

    if (executionState.youtubeFetchedAt !== null) {
      const contextRow = await prisma.channelYoutubeContext.findUnique({
        where: {
          channelId: input.channelId,
        },
        select: {
          context: true,
          fetchedAt: true,
          lastError: true,
        },
      });
      const cachedContext = getCachedYoutubeContext(contextRow);

      if (!cachedContext) {
        throw new ServiceError(
          "YOUTUBE_CONTEXT_MISSING",
          500,
          "YouTube context missing after youtubeFetchedAt set",
        );
      }

      youtubeContext = cachedContext;
      logProviderSpend({
        provider: "youtube_context",
        operation: "refresh_context",
        outcome: "payload_reuse",
        retryAttempt: true,
        durationMs: 0,
      });
    } else {
      const youtubeContextStartedAt = Date.now();
      youtubeContext = await (async () => {
        try {
          return await refreshYoutubeContext({
            channelId: executionState.channel.id,
            youtubeChannelId: executionState.channel.youtubeChannelId,
            youtubeApiKey,
            cachedContextRow: executionState.channel.youtubeContext,
          });
        } catch (error) {
          logProviderSpend({
            provider: "youtube_context",
            operation: "refresh_context",
            outcome: "error",
            retryAttempt: youtubeRetryAttempt,
            durationMs: Date.now() - youtubeContextStartedAt,
          });

          if (isYoutubeChannelContextProviderError(error)) {
            throw new ServiceError(error.code, error.status, error.message);
          }

          throw error;
        }
      })();

      logProviderSpend({
        provider: "youtube_context",
        operation: "refresh_context",
        outcome: "fresh_call",
        retryAttempt: youtubeRetryAttempt,
        durationMs: Date.now() - youtubeContextStartedAt,
      });

      await prisma.channelEnrichment.update({
        where: {
          channelId: input.channelId,
        },
        data: {
          youtubeFetchedAt: new Date(),
        },
      });
    }

    let youtubeMetrics: ReturnType<typeof deriveYoutubeMetrics> | null = null;
    let enrichmentResult: {
      profile: ReturnType<typeof extractProfileFromRawPayload>;
      rawPayload: unknown;
    };
    const openAiRetryAttempt = executionState.rawOpenaiPayloadFetchedAt !== null;

    if (executionState.rawOpenaiPayloadFetchedAt !== null) {
      if (executionState.rawOpenaiPayload === null) {
        throw new ServiceError(
          "OPENAI_INVALID_STORED_PAYLOAD",
          500,
          "Stored OpenAI payload is invalid",
        );
      }

      enrichmentResult = {
        profile: extractProfileFromRawPayload(executionState.rawOpenaiPayload),
        rawPayload: executionState.rawOpenaiPayload,
      };
      logProviderSpend({
        provider: "openai",
        operation: "enrich_channel",
        outcome: "payload_reuse",
        retryAttempt: true,
        durationMs: 0,
      });
    } else {
      youtubeMetrics = deriveYoutubeMetrics(youtubeContext);
      const openAiStartedAt = Date.now();
      const result = await (async () => {
        try {
          return await enrichChannelWithOpenAi({
            channel: {
              youtubeChannelId: executionState.channel.youtubeChannelId,
              title: executionState.channel.title,
              handle: youtubeMetrics.normalizedHandle,
              description: executionState.channel.description,
            },
            youtubeContext: youtubeMetrics.context,
            derivedSignals: deriveChannelClassificationSignals(youtubeMetrics.context),
          });
        } catch (error) {
          logProviderSpend({
            provider: "openai",
            operation: "enrich_channel",
            outcome: "error",
            retryAttempt: openAiRetryAttempt,
            durationMs: Date.now() - openAiStartedAt,
          });

          if (isOpenAiChannelEnrichmentError(error)) {
            throw new ServiceError(error.code, error.status, error.message);
          }

          throw error;
        }
      })();

      const tokenUsage = extractTokenUsage(result.rawPayload);

      if (tokenUsage) {
        logProviderSpend({
          provider: "openai",
          operation: "enrich_channel",
          outcome: "fresh_call",
          retryAttempt: openAiRetryAttempt,
          durationMs: Date.now() - openAiStartedAt,
          tokenUsage,
        });
      } else {
        logProviderSpend({
          provider: "openai",
          operation: "enrich_channel",
          outcome: "fresh_call",
          retryAttempt: openAiRetryAttempt,
          durationMs: Date.now() - openAiStartedAt,
        });
      }

      await prisma.channelEnrichment.update({
        where: {
          channelId: input.channelId,
        },
        data: {
          rawOpenaiPayload: toJsonValue(result.rawPayload),
          rawOpenaiPayloadFetchedAt: new Date(),
        },
      });

      enrichmentResult = result;
    }

    youtubeMetrics ??= deriveYoutubeMetrics(youtubeContext);
    const creatorListYoutubeMetrics = deriveCreatorListYoutubeMetrics(youtubeMetrics.context);
    const canonicalUrl = youtubeMetrics.canonicalUrl
      || executionState.channel.youtubeUrl
      || `https://www.youtube.com/channel/${executionState.channel.youtubeChannelId}`;
    const [dropdownOptions, pageSignal] = await Promise.all([
      listDropdownOptions(),
      fetchChannelPageSignalBestEffort(canonicalUrl),
    ]);
    const profileValues = await enrichChannelCreatorProfileFieldsBestEffort({
      channel: executionState.channel,
      youtubeContext: youtubeMetrics.context,
      pageSignal,
      dropdownOptions,
    });
    const inferredVerticals = inferVerticalsForHubspot({
      structuredProfile: enrichmentResult.profile.structuredProfile,
      topics: enrichmentResult.profile.topics,
      audienceInterests: null,
    });
    const influencerTypeUpdate = resolveDropdownUpdate({
      currentValue: executionState.channel.influencerType,
      options: dropdownOptions.influencerType,
      candidates: [getProfileResultValue(profileValues, "influencerType")],
    });
    const influencerVerticalUpdate = resolveDropdownUpdate({
      currentValue: executionState.channel.influencerVertical,
      options: dropdownOptions.influencerVertical,
      candidates: [
        getProfileResultValue(profileValues, "influencerVertical"),
        ...inferredVerticals,
        ...enrichmentResult.profile.topics,
      ],
    });
    const countryRegionUpdate = resolveDropdownUpdate({
      currentValue: executionState.channel.countryRegion,
      options: dropdownOptions.countryRegion,
      candidates: [
        getProfileResultValue(profileValues, "countryRegion"),
        ...(enrichmentResult.profile.structuredProfile?.geoHints ?? []),
      ],
    });
    const languageUpdate = resolveDropdownUpdate({
      currentValue: executionState.channel.contentLanguage,
      options: dropdownOptions.language,
      candidates: [
        getProfileResultValue(profileValues, "language"),
        mapYoutubeLanguageToHubspot(youtubeMetrics.context.defaultLanguage ?? ""),
        enrichmentResult.profile.structuredProfile?.language ?? "",
      ],
    });
    const preferredEmail = executionState.channel.contacts.length === 0
      ? getPreferredCreatorEmail(youtubeMetrics.context, pageSignal)
        || extractExplicitEmailsFromText(getProfileResultValue(profileValues, "email"))[0]
        || ""
      : "";
    const influencerTypeValue = applyDropdownUpdate(influencerTypeUpdate);
    const influencerVerticalValue = applyDropdownUpdate(influencerVerticalUpdate);
    const countryRegionValue = applyDropdownUpdate(countryRegionUpdate);
    const languageValue = applyDropdownUpdate(languageUpdate);

    await prisma.$transaction(async (tx) => {
      await tx.channelYoutubeContext.update({
        where: {
          channelId: executionState.channel.id,
        },
        data: {
          context: toJsonValue(youtubeMetrics.context),
          lastError: null,
        },
      });

      await tx.channel.update({
        where: {
          id: executionState.channel.id,
        },
        data: {
          handle: youtubeMetrics.normalizedHandle,
          youtubeUrl: youtubeMetrics.canonicalUrl,
          description: executionState.channel.description ?? youtubeMetrics.context.description,
          thumbnailUrl: youtubeMetrics.context.thumbnailUrl,
          contentLanguage: languageValue
            ?? (mapYoutubeLanguageToHubspot(youtubeMetrics.context.defaultLanguage) || null),
          ...(influencerTypeValue !== undefined
            ? { influencerType: influencerTypeValue }
            : {}),
          ...(influencerVerticalValue !== undefined
            ? { influencerVertical: influencerVerticalValue }
            : {}),
          ...(countryRegionValue !== undefined
            ? { countryRegion: countryRegionValue }
            : {}),
        },
      });

      if (preferredEmail) {
        await tx.channelContact.create({
          data: {
            channelId: executionState.channel.id,
            email: preferredEmail,
          },
        });
      }

      await tx.channelMetric.upsert({
        where: {
          channelId: executionState.channel.id,
        },
        create: {
          channelId: executionState.channel.id,
          subscriberCount: toNullableBigInt(youtubeMetrics.context.subscriberCount),
          viewCount: toNullableBigInt(youtubeMetrics.context.viewCount),
          videoCount: toNullableBigInt(youtubeMetrics.context.videoCount),
          youtubeEngagementRate: youtubeMetrics.engagementRate,
          youtubeFollowers: toNullableBigInt(youtubeMetrics.context.subscriberCount),
          youtubeVideoMedianViews: toNullableBigInt(creatorListYoutubeMetrics.medianVideoViews),
          youtubeShortsMedianViews: toNullableBigInt(creatorListYoutubeMetrics.medianShortsViews),
        },
        update: {
          subscriberCount: toNullableBigInt(youtubeMetrics.context.subscriberCount),
          viewCount: toNullableBigInt(youtubeMetrics.context.viewCount),
          videoCount: toNullableBigInt(youtubeMetrics.context.videoCount),
          youtubeEngagementRate: youtubeMetrics.engagementRate,
          youtubeFollowers: toNullableBigInt(youtubeMetrics.context.subscriberCount),
          youtubeVideoMedianViews: toNullableBigInt(creatorListYoutubeMetrics.medianVideoViews),
          youtubeShortsMedianViews: toNullableBigInt(creatorListYoutubeMetrics.medianShortsViews),
        },
      });

      const completedAt = new Date();

      await tx.channelEnrichment.update({
        where: {
          channelId: executionState.channelId,
        },
        data: {
          status: PrismaChannelEnrichmentStatus.COMPLETED,
          completedAt,
          lastEnrichedAt: completedAt,
          retryCount: 0,
          nextRetryAt: null,
          lastError: null,
          youtubeFetchedAt: null,
          rawOpenaiPayloadFetchedAt: null,
          summary: enrichmentResult.profile.summary,
          topics: toJsonValue(enrichmentResult.profile.topics),
          brandFitNotes: enrichmentResult.profile.brandFitNotes,
          confidence: enrichmentResult.profile.confidence,
          structuredProfile:
            enrichmentResult.profile.structuredProfile === null
              ? Prisma.DbNull
              : toJsonValue(enrichmentResult.profile.structuredProfile),
        },
      });
    });
  } catch (error) {
    await markChannelLlmEnrichmentFailed({
      channelId: input.channelId,
      error,
    });

    throw error;
  }
}

export * from "./status";
export * from "./continuous";
