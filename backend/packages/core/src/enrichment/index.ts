import {
  ChannelManualOverrideField,
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
  ChannelYoutubeRefreshStatus as PrismaChannelYoutubeRefreshStatus,
  CredentialProvider,
  Prisma,
} from "@prisma/client";
import type {
  BulkRetryChannelEnrichmentResponse,
  CatalogChannelFilters,
  RequestChannelEnrichmentResponse,
} from "@scouting-platform/contracts";
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
import {
  getChannelById,
  listAllChannelIdsForCatalogFilters,
} from "../channels";
import { listDropdownOptions } from "../dropdown-values";
import { ServiceError } from "../errors";
import { mapYoutubeLanguageToHubspot } from "../hubspot/language-mapping";
import { inferVerticalsForHubspot } from "../hubspot/vertical-inference";
import { enqueueJob } from "../queue";
import { logProviderSpend } from "../telemetry";
import { deriveChannelClassificationSignals } from "./classification-signals";
import {
  markChannelLlmEnrichmentFailed,
  markChannelYoutubeRefreshFailed,
} from "./continuous";
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

type BulkEnrichmentChannelRow = {
  id: string;
  updatedAt: Date;
  enrichment: {
    status: PrismaChannelEnrichmentStatus;
    completedAt: Date | null;
    lastEnrichedAt: Date | null;
  } | null;
};

const BULK_CHANNEL_ENRICHMENT_CHUNK_SIZE = 500;
const BULK_CHANNEL_ENRICHMENT_ENQUEUE_CONCURRENCY = 8;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code
  );
}

function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

async function mapWithConcurrencyLimit<Input>(
  items: readonly Input[],
  concurrencyLimit: number,
  mapper: (item: Input) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];

      if (item === undefined) {
        return;
      }

      await mapper(item);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrencyLimit, items.length) }, () => worker()),
  );
}

function shouldQueueBulkChannelEnrichment(
  channel: BulkEnrichmentChannelRow,
): boolean {
  const resolvedStatus = resolveChannelEnrichmentStatus({
    channelUpdatedAt: channel.updatedAt,
    enrichment: channel.enrichment,
  });

  return (
    resolvedStatus === "missing" ||
    resolvedStatus === "failed" ||
    resolvedStatus === "stale"
  );
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

type MutableYoutubeSignalField = "title" | "handle" | "description" | "thumbnailUrl";

type YoutubeSignalManualOverride = {
  id: string;
  field: ChannelManualOverrideField;
  value: string | null;
  fallbackValue: string | null;
};

type YoutubeSignalChannel = {
  id: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  youtubeUrl: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  contentLanguage: string | null;
  manualOverrides: YoutubeSignalManualOverride[];
};

function setChannelFieldValue(
  target: Prisma.ChannelUpdateInput,
  field: MutableYoutubeSignalField,
  value: string | null,
): void {
  switch (field) {
    case "title":
      if (value !== null) {
        target.title = value;
      }
      return;
    case "handle":
      target.handle = value;
      return;
    case "description":
      target.description = value;
      return;
    case "thumbnailUrl":
      target.thumbnailUrl = value;
      return;
  }
}

function getManualOverride(
  manualOverrides: readonly YoutubeSignalManualOverride[],
  field: ChannelManualOverrideField,
): YoutubeSignalManualOverride | undefined {
  return manualOverrides.find((manualOverride) => manualOverride.field === field);
}

async function applyYoutubeSignalFieldUpdate(input: {
  tx: Prisma.TransactionClient;
  channel: YoutubeSignalChannel;
  updateData: Prisma.ChannelUpdateInput;
  prismaField: ChannelManualOverrideField;
  channelField: MutableYoutubeSignalField;
  automatedValue: string | null;
  shouldUpdateWithoutOverride: boolean;
}): Promise<void> {
  const manualOverride = getManualOverride(
    input.channel.manualOverrides,
    input.prismaField,
  );

  if (manualOverride) {
    if (manualOverride.fallbackValue !== input.automatedValue) {
      await input.tx.channelManualOverride.update({
        where: {
          id: manualOverride.id,
        },
        data: {
          fallbackValue: input.automatedValue,
        },
      });
    }

    const value = input.channelField === "title"
      ? manualOverride.value ?? input.channel.title
      : manualOverride.value;

    setChannelFieldValue(input.updateData, input.channelField, value);
    return;
  }

  if (input.shouldUpdateWithoutOverride) {
    setChannelFieldValue(input.updateData, input.channelField, input.automatedValue);
  }
}

async function persistYoutubeSignals(input: {
  tx: Prisma.TransactionClient;
  channel: YoutubeSignalChannel;
  youtubeMetrics: ReturnType<typeof deriveYoutubeMetrics>;
}): Promise<void> {
  const creatorListYoutubeMetrics = deriveCreatorListYoutubeMetrics(input.youtubeMetrics.context);
  const updateData: Prisma.ChannelUpdateInput = {
    youtubeUrl: input.youtubeMetrics.canonicalUrl,
  };
  const shouldUpdateTitle = shouldReplaceChannelTitleWithYoutubeTitle({
    currentTitle: input.channel.title,
    youtubeTitle: input.youtubeMetrics.context.title,
    youtubeChannelId: input.channel.youtubeChannelId,
    currentHandle: input.channel.handle,
    currentYoutubeUrl: input.channel.youtubeUrl,
    hasManualTitleOverride: Boolean(
      getManualOverride(input.channel.manualOverrides, ChannelManualOverrideField.TITLE),
    ),
  });

  await applyYoutubeSignalFieldUpdate({
    tx: input.tx,
    channel: input.channel,
    updateData,
    prismaField: ChannelManualOverrideField.TITLE,
    channelField: "title",
    automatedValue: input.youtubeMetrics.context.title,
    shouldUpdateWithoutOverride: shouldUpdateTitle,
  });
  await applyYoutubeSignalFieldUpdate({
    tx: input.tx,
    channel: input.channel,
    updateData,
    prismaField: ChannelManualOverrideField.HANDLE,
    channelField: "handle",
    automatedValue: input.youtubeMetrics.normalizedHandle,
    shouldUpdateWithoutOverride: true,
  });
  await applyYoutubeSignalFieldUpdate({
    tx: input.tx,
    channel: input.channel,
    updateData,
    prismaField: ChannelManualOverrideField.DESCRIPTION,
    channelField: "description",
    automatedValue: input.youtubeMetrics.context.description,
    shouldUpdateWithoutOverride: input.channel.description === null,
  });
  await applyYoutubeSignalFieldUpdate({
    tx: input.tx,
    channel: input.channel,
    updateData,
    prismaField: ChannelManualOverrideField.THUMBNAIL_URL,
    channelField: "thumbnailUrl",
    automatedValue: input.youtubeMetrics.context.thumbnailUrl,
    shouldUpdateWithoutOverride: true,
  });

  updateData.contentLanguage =
    mapYoutubeLanguageToHubspot(input.youtubeMetrics.context.defaultLanguage ?? "")
    || input.channel.contentLanguage
    || null;

  await input.tx.channelYoutubeContext.update({
    where: {
      channelId: input.channel.id,
    },
    data: {
      context: toJsonValue(input.youtubeMetrics.context),
      lastError: null,
    },
  });

  await input.tx.channel.update({
    where: {
      id: input.channel.id,
    },
    data: updateData,
  });

  await input.tx.channelMetric.upsert({
    where: {
      channelId: input.channel.id,
    },
    create: {
      channelId: input.channel.id,
      subscriberCount: toNullableBigInt(input.youtubeMetrics.context.subscriberCount),
      viewCount: toNullableBigInt(input.youtubeMetrics.context.viewCount),
      videoCount: toNullableBigInt(input.youtubeMetrics.context.videoCount),
      youtubeEngagementRate: input.youtubeMetrics.engagementRate,
      youtubeFollowers: toNullableBigInt(input.youtubeMetrics.context.subscriberCount),
      youtubeVideoMedianViews: toNullableBigInt(creatorListYoutubeMetrics.medianVideoViews),
      youtubeShortsMedianViews: toNullableBigInt(creatorListYoutubeMetrics.medianShortsViews),
    },
    update: {
      subscriberCount: toNullableBigInt(input.youtubeMetrics.context.subscriberCount),
      viewCount: toNullableBigInt(input.youtubeMetrics.context.viewCount),
      videoCount: toNullableBigInt(input.youtubeMetrics.context.videoCount),
      youtubeEngagementRate: input.youtubeMetrics.engagementRate,
      youtubeFollowers: toNullableBigInt(input.youtubeMetrics.context.subscriberCount),
      youtubeVideoMedianViews: toNullableBigInt(creatorListYoutubeMetrics.medianVideoViews),
      youtubeShortsMedianViews: toNullableBigInt(creatorListYoutubeMetrics.medianShortsViews),
    },
  });
}

function deriveYoutubeUrlTitlePlaceholder(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalizedValue = /^https?:\/\//iu.test(value) ? value : `https://${value}`;

  try {
    const parsedUrl = new URL(normalizedValue);
    const pathParts = parsedUrl.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });
    const first = pathParts[0] ?? "";
    const second = pathParts[1] ?? "";
    const firstLower = first.toLowerCase();

    if (first.startsWith("@")) {
      return first;
    }

    if (firstLower === "channel" && second) {
      return second;
    }

    if ((firstLower === "c" || firstLower === "user") && second) {
      return second;
    }

    if (first) {
      return first;
    }
  } catch {
    return null;
  }

  return null;
}

function shouldReplaceChannelTitleWithYoutubeTitle(input: {
  currentTitle: string;
  youtubeTitle: string | null;
  youtubeChannelId: string;
  currentHandle: string | null;
  currentYoutubeUrl: string | null;
  hasManualTitleOverride: boolean;
}): boolean {
  const youtubeTitle = input.youtubeTitle?.trim();

  if (!youtubeTitle || input.hasManualTitleOverride) {
    return false;
  }

  const currentTitle = input.currentTitle.trim();
  const normalizedCurrentTitle = currentTitle.toLowerCase();
  const handle = input.currentHandle?.trim().toLowerCase() ?? "";
  const handleWithPrefix = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : "";
  const urlPlaceholder = deriveYoutubeUrlTitlePlaceholder(input.currentYoutubeUrl)?.toLowerCase() ?? "";

  return normalizedCurrentTitle === input.youtubeChannelId.toLowerCase()
    || normalizedCurrentTitle === handle
    || normalizedCurrentTitle === handleWithPrefix
    || (urlPlaceholder.length > 0 && normalizedCurrentTitle === urlPlaceholder);
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
  forceRefresh?: boolean;
}) {
  const cachedContext = getCachedYoutubeContext(input.cachedContextRow);

  if (
    !input.forceRefresh &&
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

export async function requestBulkChannelLlmEnrichment(input: {
  filters: CatalogChannelFilters;
  requestedByUserId: string;
}): Promise<BulkRetryChannelEnrichmentResponse> {
  const channelIds = await listAllChannelIdsForCatalogFilters(input.filters);

  if (channelIds.length === 0) {
    return {
      requestedCount: 0,
      queuedCount: 0,
      alreadyQueuedCount: 0,
      failedCount: 0,
    };
  }

  const hasYoutubeKey = await prisma.userProviderCredential.findUnique({
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

  const requestedAt = new Date();
  let alreadyQueuedCount = 0;
  const queuedChannelIds: string[] = [];

  for (const channelIdChunk of chunkArray(channelIds, BULK_CHANNEL_ENRICHMENT_CHUNK_SIZE)) {
    const chunkQueuedChannelIds = await withDbTransaction(async (tx) => {
      const channels = await tx.channel.findMany({
        where: {
          id: {
            in: channelIdChunk,
          },
        },
        select: {
          id: true,
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
      const queueableChannels = channels.filter(shouldQueueBulkChannelEnrichment);
      const existingQueueableChannelIds = queueableChannels
        .filter((channel) => channel.enrichment !== null)
        .map((channel) => channel.id);
      const missingQueueableChannels = queueableChannels
        .filter((channel) => channel.enrichment === null);

      alreadyQueuedCount += channels.length - queueableChannels.length;

      if (existingQueueableChannelIds.length > 0) {
        await tx.channelEnrichment.updateMany({
          where: {
            channelId: {
              in: existingQueueableChannelIds,
            },
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
      }

      if (missingQueueableChannels.length > 0) {
        await tx.channelEnrichment.createMany({
          data: missingQueueableChannels.map((channel) => ({
            channelId: channel.id,
            status: PrismaChannelEnrichmentStatus.QUEUED,
            requestedByUserId: input.requestedByUserId,
            requestedAt,
            retryCount: 0,
            nextRetryAt: null,
          })),
          skipDuplicates: true,
        });
      }

      if (queueableChannels.length > 0) {
        await tx.auditEvent.createMany({
          data: queueableChannels.map((channel) => ({
            actorUserId: input.requestedByUserId,
            action: "channel.enrichment.requested",
            entityType: "channel",
            entityId: channel.id,
            metadata: {
              previousStatus: resolveChannelEnrichmentStatus({
                channelUpdatedAt: channel.updatedAt,
                enrichment: channel.enrichment,
              }),
              queued: true,
              bulkRequest: true,
              bulkRequestedCount: channelIds.length,
            },
          })),
        });
      }

      return queueableChannels.map((channel) => channel.id);
    });

    queuedChannelIds.push(...chunkQueuedChannelIds);
  }

  let queuedCount = 0;
  let failedCount = 0;

  await mapWithConcurrencyLimit(
    queuedChannelIds,
    BULK_CHANNEL_ENRICHMENT_ENQUEUE_CONCURRENCY,
    async (channelId) => {
      try {
        await enqueueJob("channels.enrich.llm", {
          channelId,
          requestedByUserId: input.requestedByUserId,
        });
        queuedCount += 1;
      } catch (error) {
        failedCount += 1;
        await markChannelLlmEnrichmentFailed({
          channelId,
          error,
        });
      }
    },
  );

  return {
    requestedCount: channelIds.length,
    queuedCount,
    alreadyQueuedCount,
    failedCount,
  };
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

export async function executeChannelYoutubeRefresh(input: {
  channelId: string;
  requestedByUserId: string;
}): Promise<void> {
  const startedAt = new Date();
  const channel = await prisma.channel.findUnique({
    where: {
      id: input.channelId,
    },
    select: {
      id: true,
      youtubeChannelId: true,
      title: true,
      handle: true,
      youtubeUrl: true,
      description: true,
      thumbnailUrl: true,
      contentLanguage: true,
      manualOverrides: {
        where: {
          field: {
            in: [
              ChannelManualOverrideField.TITLE,
              ChannelManualOverrideField.HANDLE,
              ChannelManualOverrideField.DESCRIPTION,
              ChannelManualOverrideField.THUMBNAIL_URL,
            ],
          },
        },
        select: {
          id: true,
          field: true,
          value: true,
          fallbackValue: true,
        },
      },
      youtubeContext: {
        select: {
          context: true,
          fetchedAt: true,
          lastError: true,
          refreshRetryCount: true,
        },
      },
    },
  });

  if (!channel) {
    throw new ServiceError("CHANNEL_NOT_FOUND", 404, "Channel not found");
  }

  let retryAttempt = false;
  const claimed = await prisma.channelYoutubeContext.updateMany({
    where: {
      channelId: input.channelId,
      refreshStatus: PrismaChannelYoutubeRefreshStatus.QUEUED,
    },
    data: {
      refreshStatus: PrismaChannelYoutubeRefreshStatus.RUNNING,
      refreshStartedAt: startedAt,
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    if (channel.youtubeContext) {
      return;
    }

    try {
      await prisma.channelYoutubeContext.create({
        data: {
          channelId: input.channelId,
          context: Prisma.DbNull,
          fetchedAt: null,
          lastError: null,
          refreshStatus: PrismaChannelYoutubeRefreshStatus.RUNNING,
          refreshRequestedAt: startedAt,
          refreshStartedAt: startedAt,
          refreshCompletedAt: null,
          refreshRetryCount: 0,
          refreshNextRetryAt: null,
        },
      });
    } catch (error) {
      if (isPrismaErrorCode(error, "P2002")) {
        return;
      }

      throw error;
    }
  } else {
    retryAttempt = (channel.youtubeContext?.refreshRetryCount ?? 0) > 0;
  }

  try {
    const youtubeApiKey = await getUserYoutubeApiKey(input.requestedByUserId);

    if (!youtubeApiKey) {
      throw new ServiceError(
        "YOUTUBE_KEY_REQUIRED",
        400,
        "Assigned YouTube API key is required before executing YouTube refresh",
      );
    }

    const youtubeContextStartedAt = Date.now();
    const youtubeContext = await (async () => {
      try {
        return await refreshYoutubeContext({
          channelId: channel.id,
          youtubeChannelId: channel.youtubeChannelId,
          youtubeApiKey,
          cachedContextRow: channel.youtubeContext,
          forceRefresh: true,
        });
      } catch (error) {
        logProviderSpend({
          provider: "youtube_context",
          operation: "refresh_context",
          outcome: "error",
          retryAttempt,
          durationMs: Date.now() - youtubeContextStartedAt,
        });

        if (isYoutubeChannelContextProviderError(error)) {
          throw new ServiceError(error.code, error.status, error.message);
        }

        throw error;
      }
    })();
    const youtubeMetrics = deriveYoutubeMetrics(youtubeContext);

    logProviderSpend({
      provider: "youtube_context",
      operation: "refresh_context",
      outcome: "fresh_call",
      retryAttempt,
      durationMs: Date.now() - youtubeContextStartedAt,
    });

    await prisma.$transaction(async (tx) => {
      await persistYoutubeSignals({
        tx,
        channel,
        youtubeMetrics,
      });

      await tx.channelYoutubeContext.update({
        where: {
          channelId: input.channelId,
        },
        data: {
          refreshStatus: PrismaChannelYoutubeRefreshStatus.COMPLETED,
          refreshCompletedAt: new Date(),
          refreshRetryCount: 0,
          refreshNextRetryAt: null,
          lastError: null,
        },
      });
    });
  } catch (error) {
    await markChannelYoutubeRefreshFailed({
      channelId: input.channelId,
      error,
    });

    throw error;
  }
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
            thumbnailUrl: true,
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
            manualOverrides: {
              where: {
                field: {
                  in: [
                    ChannelManualOverrideField.TITLE,
                    ChannelManualOverrideField.HANDLE,
                    ChannelManualOverrideField.DESCRIPTION,
                    ChannelManualOverrideField.THUMBNAIL_URL,
                  ],
                },
              },
              select: {
                id: true,
                field: true,
                value: true,
                fallbackValue: true,
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
    const [dropdownOptions, pageSignal] = await Promise.all([
      listDropdownOptions(),
      fetchChannelPageSignalBestEffort(youtubeMetrics.canonicalUrl),
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
      await persistYoutubeSignals({
        tx,
        channel: executionState.channel,
        youtubeMetrics,
      });

      await tx.channel.update({
        where: {
          id: executionState.channel.id,
        },
        data: {
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
