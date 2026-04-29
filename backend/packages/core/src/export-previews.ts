import {
  HubspotPreviewEnrichmentJobStatus as PrismaHubspotPreviewEnrichmentJobStatus,
  Prisma,
  RunMonth,
} from "@prisma/client";
import {
  channelStructuredProfileSchema,
} from "@scouting-platform/contracts";
import type {
  CsvExportPreview,
  ExportPreviewColumn,
  ExportPreviewRow,
  ExportPreviewValidationIssue,
  HubspotExportPreview,
  HubspotPreviewEnrichmentJobSummary,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import {
  enrichCreatorProfilesWithOpenAi,
  fetchYoutubeChannelContext,
  fetchYoutubeChannelPageEmailSignal,
  isYoutubeChannelContextProviderError,
  type CreatorProfileEnrichmentResult,
  type YoutubeChannelContext,
  type YoutubeChannelPageEmailSignal,
  youtubeChannelContextSchema,
} from "@scouting-platform/integrations";

import { getUserYoutubeApiKey } from "./auth";
import { listDropdownOptions } from "./dropdown-values";
import {
  buildCanonicalYoutubeUrl,
  deriveCreatorListYoutubeMetrics,
  normalizeYoutubeContext,
  normalizeYoutubeHandle,
} from "./enrichment/metrics";
import { ServiceError } from "./errors";
import { mapYoutubeLanguageToHubspot } from "./hubspot/language-mapping";
import {
  applyHubspotPreparationRows,
  buildHubspotRowKey,
  normalizeHubspotPrepDefaults,
  resolveHubspotInfluencerTypeFallback,
} from "./hubspot/preparation";
import { inferVerticalsForHubspot } from "./hubspot/vertical-inference";
import { enqueueJob } from "./queue";

const runPreviewSelect = {
  id: true,
  requestedByUserId: true,
  name: true,
  campaignName: true,
  client: true,
  market: true,
  briefLink: true,
  month: true,
  year: true,
  dealOwner: true,
  pipeline: true,
  dealStage: true,
  currency: true,
  dealType: true,
  activationType: true,
  hubspotInfluencerType: true,
  hubspotInfluencerVertical: true,
  hubspotCountryRegion: true,
  hubspotLanguage: true,
  hubspotRowOverrides: {
    orderBy: {
      createdAt: "asc",
    },
    select: {
      rowKey: true,
      firstName: true,
      lastName: true,
      email: true,
      phoneNumber: true,
      currency: true,
      dealType: true,
      activationType: true,
      influencerType: true,
      influencerVertical: true,
      countryRegion: true,
      language: true,
    },
  },
  campaignManagerUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  results: {
    orderBy: {
      rank: "asc",
    },
    select: {
      id: true,
      channelId: true,
      channel: {
        select: {
          id: true,
          title: true,
          handle: true,
          youtubeChannelId: true,
          youtubeUrl: true,
          influencerType: true,
          influencerVertical: true,
          countryRegion: true,
          description: true,
          contentLanguage: true,
          contacts: {
            orderBy: {
              email: "asc",
            },
            select: {
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          metrics: {
            select: {
              youtubeEngagementRate: true,
              youtubeFollowers: true,
              youtubeVideoMedianViews: true,
              youtubeShortsMedianViews: true,
            },
          },
          youtubeContext: {
            select: {
              context: true,
            },
          },
          enrichment: {
            select: {
              topics: true,
              structuredProfile: true,
            },
          },
          insights: {
            select: {
              audienceCountries: true,
              audienceInterests: true,
            },
          },
        },
      },
    },
  },
} as const;

function column(
  key: string,
  label: string,
  editable: boolean,
  required = false,
  fieldType: "text" | "dropdown" | "readonly" = "text",
  dropdownFieldKey: ExportPreviewColumn["dropdownFieldKey"] = null,
): ExportPreviewColumn {
  return {
    key,
    label,
    editable,
    required,
    fieldType,
    dropdownFieldKey,
  };
}

const HUBSPOT_COLUMNS: ExportPreviewColumn[] = [
  column("contactType", "Contact Type", false, true, "readonly"),
  column("campaignName", "Campaign Name", false, true),
  column("month", "Month", false, true),
  column("year", "Year", false, true),
  column("clientName", "Client name", false, true),
  column("dealOwner", "Deal owner", false, true),
  column("dealName", "Deal name", false, true),
  column("activationName", "Activation name", false),
  column("pipeline", "Pipeline", false, true),
  column("dealStage", "Deal stage", false, true),
  column("currency", "Currency", true, true, "dropdown", "currency"),
  column("dealType", "Deal Type", true, true, "dropdown", "dealType"),
  column("activationType", "Activation Type", true, true, "dropdown", "activationType"),
  column("firstName", "First Name", true, true),
  column("lastName", "Last Name", true, true),
  column("email", "Email", true, true),
  column("phoneNumber", "Phone Number", true),
  column("influencerType", "Influencer Type", true, true, "dropdown", "influencerType"),
  column("influencerVertical", "Influencer Vertical", true, true, "dropdown", "influencerVertical"),
  column("countryRegion", "Country/Region", true, true, "dropdown", "countryRegion"),
  column("language", "Language", true, true, "dropdown", "language"),
  column("youtubeHandle", "YouTube Handle", false),
  column("youtubeUrl", "YouTube URL", false),
  column("youtubeVideoMedianViews", "YouTube Video Median Views", false),
  column("youtubeShortsMedianViews", "YouTube Shorts Median Views", false),
  column("youtubeEngagementRate", "YouTube Engagement Rate", false),
  column("youtubeFollowers", "YouTube Followers", false),
  column("instagramHandle", "Instagram Handle", true),
  column("instagramUrl", "Instagram URL", true),
  column("instagramPostAverageViews", "Instagram Post Average Views", true),
  column("instagramReelAverageViews", "Instagram Reel Average Views", true),
  column("instagramStory7DayAverageViews", "Instagram Story 7-day Average Views", true),
  column("instagramStory30DayAverageViews", "Instagram Story 30-day Average Views", true),
  column("instagramEngagementRate", "Instagram Engagement Rate", true),
  column("instagramFollowers", "Instagram Followers", true),
  column("tiktokHandle", "TikTok Handle", true),
  column("tiktokUrl", "TikTok URL", true),
  column("tiktokAverageViews", "TikTok Average Views", true),
  column("tiktokEngagementRate", "TikTok Engagement Rate", true),
  column("tiktokFollowers", "TikTok Followers", true),
  column("twitchHandle", "Twitch Handle", true),
  column("twitchUrl", "Twitch URL", true),
  column("twitchAverageViews", "Twitch Average Views", true),
  column("twitchEngagementRate", "Twitch Engagement Rate", true),
  column("twitchFollowers", "Twitch Followers", true),
  column("kickHandle", "Kick Handle", true),
  column("kickUrl", "Kick URL", true),
  column("kickAverageViews", "Kick Average Views", true),
  column("kickEngagementRate", "Kick Engagement Rate", true),
  column("kickFollowers", "Kick Followers", true),
  column("xHandle", "X Handle", true),
  column("xUrl", "X URL", true),
  column("xAverageViews", "X Average Views", true),
  column("xEngagementRate", "X Engagement Rate", true),
  column("xFollowers", "X Followers", true),
];

const CSV_COLUMNS: ExportPreviewColumn[] = [
  column("runName", "Run name", false),
  column("campaignName", "Campaign name", false),
  column("clientName", "Client name", false),
  column("market", "Market", false),
  column("briefLink", "Brief link", false),
  column("channelTitle", "Channel title", false),
  column("email", "Email", false),
  column("firstName", "First Name", false),
  column("lastName", "Last Name", false),
  column("youtubeHandle", "YouTube Handle", false),
  column("youtubeUrl", "YouTube URL", false),
  column("youtubeEngagementRate", "YouTube Engagement Rate", false),
  column("youtubeFollowers", "YouTube Followers", false),
  column("influencerVertical", "Influencer Vertical", false),
  column("countryRegion", "Country/Region", false),
];

type RunPreviewRecord = Prisma.RunRequestGetPayload<{ select: typeof runPreviewSelect }>;

const hubspotPreviewEnrichmentJobSummarySelect = {
  id: true,
  runRequestId: true,
  status: true,
  progressPercentage: true,
  progressMessage: true,
  processedChannelCount: true,
  updatedRowCount: true,
  updatedFieldCount: true,
  failedChannelCount: true,
  lastError: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
} as const;

type HubspotPreviewEnrichmentJobSummaryRecord = Prisma.HubspotPreviewEnrichmentJobGetPayload<{
  select: typeof hubspotPreviewEnrichmentJobSummarySelect;
}>;

function toHubspotPreviewEnrichmentJobSummary(
  job: HubspotPreviewEnrichmentJobSummaryRecord,
): HubspotPreviewEnrichmentJobSummary {
  return {
    id: job.id,
    runId: job.runRequestId,
    status: job.status.toLowerCase() as HubspotPreviewEnrichmentJobSummary["status"],
    progressPercentage: job.progressPercentage,
    progressMessage: job.progressMessage,
    processedChannelCount: job.processedChannelCount,
    updatedRowCount: job.updatedRowCount,
    updatedFieldCount: job.updatedFieldCount,
    failedChannelCount: job.failedChannelCount,
    lastError: job.lastError,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

function normalizeMonth(value: RunMonth | null): string {
  return value ? `${value.charAt(0)}${value.slice(1).toLowerCase()}` : "";
}

function toText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

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

function getTopTopic(topics: Prisma.JsonValue | null): string {
  if (!Array.isArray(topics)) {
    return "";
  }

  for (const topic of topics) {
    if (typeof topic === "string" && topic.trim()) {
      return topic.trim();
    }
  }

  return "";
}

function getTopCountry(audienceCountries: Prisma.JsonValue | null): string {
  if (!Array.isArray(audienceCountries)) {
    return "";
  }

  let topCountry = "";
  let topPercentage = -1;

  for (const item of audienceCountries) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    const countryName = typeof candidate.countryName === "string" ? candidate.countryName : "";
    const percentage = typeof candidate.percentage === "number" ? candidate.percentage : 0;

    if (countryName && percentage > topPercentage) {
      topCountry = countryName;
      topPercentage = percentage;
    }
  }

  return topCountry;
}

function getParsedYoutubeContext(context: Prisma.JsonValue | null) {
  if (!context) {
    return null;
  }

  const parsedContext = youtubeChannelContextSchema.safeParse(context);
  return parsedContext.success ? parsedContext.data : null;
}

function getParsedStructuredProfile(structuredProfile: Prisma.JsonValue | null) {
  if (!structuredProfile) {
    return null;
  }

  const parsed = channelStructuredProfileSchema.safeParse(structuredProfile);
  return parsed.success ? parsed.data : null;
}

function getCreatorListYoutubeValues(
  context: Prisma.JsonValue | null,
): {
  youtubeVideoMedianViews: string;
  youtubeShortsMedianViews: string;
  youtubeEngagementRate: string;
} {
  const parsedContext = getParsedYoutubeContext(context);

  if (!parsedContext) {
    return {
      youtubeVideoMedianViews: "",
      youtubeShortsMedianViews: "",
      youtubeEngagementRate: "",
    };
  }

  const metrics = deriveCreatorListYoutubeMetrics(parsedContext);

  return {
    youtubeVideoMedianViews: toText(metrics.medianVideoViews),
    youtubeShortsMedianViews: toText(metrics.medianShortsViews),
    youtubeEngagementRate: toText(metrics.medianVideoEngagementRate),
  };
}

function getPreferredYoutubeHandle(channel: RunPreviewRecord["results"][number]["channel"]): string {
  const directHandle = channel.handle?.trim() ?? "";

  if (directHandle) {
    return directHandle;
  }

  return getParsedYoutubeContext(channel.youtubeContext?.context ?? null)?.handle?.trim() ?? "";
}

function getPreferredYoutubeUrl(channel: RunPreviewRecord["results"][number]["channel"]): string {
  const directUrl = channel.youtubeUrl?.trim() ?? "";

  if (directUrl) {
    return directUrl;
  }

  const handle = getPreferredYoutubeHandle(channel);

  if (handle) {
    return `https://www.youtube.com/${handle.startsWith("@") ? handle : `@${handle}`}`;
  }

  return `https://www.youtube.com/channel/${channel.youtubeChannelId}`;
}

function getPreferredCreatorLabel(channel: RunPreviewRecord["results"][number]["channel"]): string {
  return getPreferredYoutubeHandle(channel) || channel.title;
}

function getHubspotInfluencerVertical(channel: RunPreviewRecord["results"][number]["channel"]): string {
  return (
    inferVerticalsForHubspot({
      structuredProfile: channel.enrichment?.structuredProfile ?? null,
      topics: channel.enrichment?.topics ?? null,
      audienceInterests: channel.insights?.audienceInterests ?? null,
    })[0] ?? ""
  );
}

function getHubspotCountryRegion(channel: RunPreviewRecord["results"][number]["channel"]): string {
  const topCountry = getTopCountry(channel.insights?.audienceCountries ?? null);

  if (topCountry) {
    return topCountry;
  }

  return getParsedStructuredProfile(channel.enrichment?.structuredProfile ?? null)?.geoHints[0] ?? "";
}

function getHubspotLanguage(channel: RunPreviewRecord["results"][number]["channel"]): string {
  const directLanguage = channel.contentLanguage?.trim() ?? "";

  if (directLanguage) {
    return directLanguage;
  }

  const structuredProfile = getParsedStructuredProfile(channel.enrichment?.structuredProfile ?? null);
  const structuredLanguage = structuredProfile?.language?.trim() ?? "";

  if (structuredLanguage) {
    return mapYoutubeLanguageToHubspot(structuredLanguage) || structuredLanguage;
  }

  return mapYoutubeLanguageToHubspot(
    getParsedYoutubeContext(channel.youtubeContext?.context ?? null)?.defaultLanguage ?? "",
  );
}

function normalizeExtractedEmailCandidate(value: string): string {
  return value
    .replace(/^mailto:/i, "")
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
      /(?:mailto:)?([A-Z0-9.!#$%&'*+=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,63})/gi;

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
    .replace(/&commat;|&#64;|&#x40;/gi, "@")
    .replace(/&period;|&#46;|&#x2e;/gi, ".");

  collectFromText(decodedHtml);

  const deobfuscated = decodedHtml
    .replace(/\s*\[\s*at\s*\]\s*/gi, "@")
    .replace(/\s*\(\s*at\s*\)\s*/gi, "@")
    .replace(/\s+\bat\b\s+/gi, "@")
    .replace(/\s*\[\s*dot\s*\]\s*/gi, ".")
    .replace(/\s*\(\s*dot\s*\)\s*/gi, ".")
    .replace(/\s+\bdot\b\s+/gi, ".");

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

function normalizeExtractedPhoneNumberCandidate(value: string): string {
  let text = value
    .replace(/^[<("'`[]+/, "")
    .replace(/[>"')\],;:!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return "";
  }

  const extensionMatch = /\b(?:ext\.?|extension|x)\s*(\d{1,6})\b/iu.exec(text);
  const extension = extensionMatch?.[1] ?? "";

  if (extensionMatch) {
    text = text.slice(0, extensionMatch.index).trim();
  }

  text = text
    .replace(/[^\d+().\-\s]/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")")
    .trim();

  if (!text) {
    return "";
  }

  if ((text.match(/\+/gu) ?? []).length > 1 || text.indexOf("+") > 0) {
    return "";
  }

  const digitCount = (text.match(/\d/gu) ?? []).length;

  if (digitCount < 7 || digitCount > 20) {
    return "";
  }

  if (!/^\+?[\d\s().-]+$/u.test(text)) {
    return "";
  }

  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/u.test(text)) {
    return "";
  }

  return extension ? `${text} ext ${extension}` : text;
}

function hasPhoneEvidenceContext(text: string, matchIndex: number, matchLength: number): boolean {
  const windowStart = Math.max(0, matchIndex - 90);
  const windowEnd = Math.min(text.length, matchIndex + matchLength + 90);
  const context = text.slice(windowStart, windowEnd);

  return /\b(?:phone|tel|telephone|call|whatsapp|sms|text|mobile|cell|contact|business|inquir(?:y|ies)|booking|bookings|management|manager|agent)\b/iu.test(
    context,
  );
}

function isInternationalPhoneCandidate(rawValue: string, normalizedValue: string): boolean {
  const raw = rawValue.trim();
  const normalized = normalizedValue.trim();
  const digitCount = (normalized.match(/\d/gu) ?? []).length;

  return digitCount >= 8 && (/^\+/u.test(normalized) || /^(?:\+|00)/u.test(raw));
}

export function extractHighConfidencePhoneNumbersFromText(value: string): string[] {
  const raw = value.trim();

  if (!raw) {
    return [];
  }

  const normalizedText = raw.replace(/&plus;|&#43;|&#x2b;/giu, "+");
  const results: string[] = [];
  const seen = new Set<string>();
  const pattern = /(?:\+|00)?\d[\d\s().-]{5,}\d(?:\s*(?:ext\.?|extension|x)\s*\d{1,6})?/giu;

  for (const match of normalizedText.matchAll(pattern)) {
    const matchedText = match[0] ?? "";
    const phoneNumber = normalizeExtractedPhoneNumberCandidate(matchedText);

    if (!phoneNumber) {
      continue;
    }

    if (
      !hasPhoneEvidenceContext(normalizedText, match.index ?? 0, matchedText.length)
      && !isInternationalPhoneCandidate(matchedText, phoneNumber)
    ) {
      continue;
    }

    const key = phoneNumber.replace(/\D/gu, "");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(phoneNumber);
  }

  return results;
}

export function extractHighConfidencePhoneNumbersFromTextList(values: readonly string[]): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    for (const phoneNumber of extractHighConfidencePhoneNumbersFromText(value)) {
      const key = phoneNumber.replace(/\D/gu, "");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      results.push(phoneNumber);
    }
  }

  return results;
}

function getPageSignalTextValues(pageSignal: YoutubeChannelPageEmailSignal | null | undefined): string[] {
  if (!pageSignal) {
    return [];
  }

  return [
    ...pageSignal.emails,
    pageSignal.snippet ?? "",
  ].filter((value) => value.trim().length > 0);
}

function getPreferredCreatorEmail(
  channel: RunPreviewRecord["results"][number]["channel"],
  pageSignal?: YoutubeChannelPageEmailSignal | null,
): string {
  const context = getParsedYoutubeContext(channel.youtubeContext?.context ?? null);

  if (!context) {
    return extractExplicitEmailsFromTextList(getPageSignalTextValues(pageSignal))[0] ?? "";
  }

  const bioEmails = extractExplicitEmailsFromText(context.description ?? "");

  if (bioEmails.length > 0) {
    return bioEmails[0] ?? "";
  }

  const pageSignalEmail = extractExplicitEmailsFromTextList(getPageSignalTextValues(pageSignal))[0] ?? "";

  if (pageSignalEmail) {
    return pageSignalEmail;
  }

  return (
    extractExplicitEmailsFromTextList(
      context.recentVideos.map((video) => video.description ?? ""),
    )[0] ?? ""
  );
}

function getPreferredCreatorPhoneNumber(
  channel: RunPreviewRecord["results"][number]["channel"],
  pageSignal?: YoutubeChannelPageEmailSignal | null,
): string {
  const context = getParsedYoutubeContext(channel.youtubeContext?.context ?? null);
  const pageSignalPhone = extractHighConfidencePhoneNumbersFromTextList(
    getPageSignalTextValues(pageSignal),
  )[0] ?? "";

  if (pageSignalPhone) {
    return pageSignalPhone;
  }

  if (!context) {
    return "";
  }

  const bioPhones = extractHighConfidencePhoneNumbersFromText(context.description ?? "");

  if (bioPhones.length > 0) {
    return bioPhones[0] ?? "";
  }

  return (
    extractHighConfidencePhoneNumbersFromTextList(
      context.recentVideos.map((video) => video.description ?? ""),
    )[0] ?? ""
  );
}

const PROFILE_RESULT_FIELD_BY_ROW_FIELD = {
  firstName: "First Name",
  lastName: "Last Name",
  email: "Email",
  influencerType: "Influencer Type",
  influencerVertical: "Influencer Vertical",
  countryRegion: "Country/Region",
  language: "Language",
} as const;

type ProfileResultRowField = keyof typeof PROFILE_RESULT_FIELD_BY_ROW_FIELD;

function getProfileResultValue(
  result: Record<string, string> | undefined,
  field: ProfileResultRowField,
): string {
  return result?.[PROFILE_RESULT_FIELD_BY_ROW_FIELD[field]]?.trim() ?? "";
}

function coerceDropdownMultiselectOption(
  options: readonly string[],
  value: string,
): string {
  const normalizedValues: string[] = [];

  for (const item of value.split(/[;,|]/u)) {
    const coerced = coerceDropdownOption(options, item);

    if (!coerced || normalizedValues.includes(coerced)) {
      continue;
    }

    normalizedValues.push(coerced);

    if (normalizedValues.length >= 3) {
      break;
    }
  }

  return normalizedValues.join("; ");
}

function buildCreatorProfileContextText(input: {
  row: ExportPreviewRow;
  channel: RunPreviewRecord["results"][number]["channel"];
  pageSignal?: YoutubeChannelPageEmailSignal | null;
}): string {
  const lines: string[] = [];
  const fields = [
    ["Channel Name", input.row.channelTitle],
    ["YouTube Handle", input.row.values.youtubeHandle],
    ["YouTube URL", input.row.values.youtubeUrl],
  ] as const;

  for (const [label, value] of fields) {
    const text = value?.trim() ?? "";

    if (text) {
      lines.push(`${label}: ${text}`);
    }
  }

  const context = getParsedYoutubeContext(input.channel.youtubeContext?.context ?? null);

  if (context?.description) {
    lines.push(`Resolved YouTube Description: ${context.description}`);
  }

  if (input.pageSignal?.emails.length) {
    lines.push(`Explicit Emails From Channel Page: ${input.pageSignal.emails.join(" | ")}`);
  }

  if (input.pageSignal?.snippet) {
    lines.push(`Channel Page/About Snippet: ${input.pageSignal.snippet}`);
  }

  if (context?.defaultLanguage) {
    lines.push(`Resolved YouTube Language: ${context.defaultLanguage}`);
  }

  const categoryNames = Array.from(
    new Set(
      (context?.recentVideos ?? [])
        .map((video) => video.categoryName ?? "")
        .filter((categoryName) => categoryName.trim().length > 0),
    ),
  );

  if (categoryNames.length > 0) {
    lines.push(`Resolved YouTube Categories: ${categoryNames.slice(0, 5).join(" | ")}`);
  }

  const sampledTitles = (context?.recentVideos ?? [])
    .map((video) => video.title)
    .filter((title) => title.trim().length > 0)
    .slice(0, 10);

  if (sampledTitles.length > 0) {
    lines.push(`Sampled Video Titles: ${sampledTitles.join(" | ")}`);
  }

  const sampledDescriptions = (context?.recentVideos ?? [])
    .map((video) => video.description ?? "")
    .filter((description) => description.trim().length > 0)
    .slice(0, 3)
    .map((description) => description.slice(0, 280));

  if (sampledDescriptions.length > 0) {
    lines.push(`Sampled Video Descriptions: ${sampledDescriptions.join(" || ")}`);
  }

  return lines.join("\n");
}

async function enrichCreatorProfileRowsBestEffort(input: {
  run: RunPreviewRecord;
  rows: ExportPreviewRow[];
  dropdownOptions: Awaited<ReturnType<typeof listDropdownOptions>>;
  pageSignalsByChannelId?: Map<string, YoutubeChannelPageEmailSignal>;
}): Promise<Map<string, Record<string, string>>> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return new Map();
  }

  const fallbackRows = buildHubspotFallbackRows(input.run);
  const rowsByRowKey = new Map(input.rows.map((row) => [row.rowKey, row]));
  const overridesByRowKey = new Map(
    input.run.hubspotRowOverrides.map((override) => [override.rowKey, override]),
  );
  const requests = fallbackRows
    .map((fallbackRow) => {
      const row = rowsByRowKey.get(fallbackRow.rowKey);

      if (!row) {
        return null;
      }

      const currentOverride = overridesByRowKey.get(fallbackRow.rowKey);
      const pageSignal = input.pageSignalsByChannelId?.get(fallbackRow.channel.id) ?? null;
      const requestedFields = ([
        "firstName",
        "lastName",
        "email",
        "influencerType",
        "influencerVertical",
        "countryRegion",
        "language",
      ] as const)
        .filter((field) => {
          const overrideValue = currentOverride?.[field]?.trim() ?? "";
          const rowValue = row.values[field]?.trim() ?? "";

          return !overrideValue && !rowValue;
        })
        .map((field) => PROFILE_RESULT_FIELD_BY_ROW_FIELD[field]);

      if (requestedFields.length === 0) {
        return null;
      }

      return {
        rowKey: fallbackRow.rowKey,
        channelName: row.channelTitle,
        channelUrl: row.values.youtubeUrl ?? "",
        campaignName: row.values.campaignName ?? "",
        requestedFields,
        contextText: buildCreatorProfileContextText({
          row,
          channel: fallbackRow.channel,
          pageSignal,
        }),
      };
    })
    .filter((request): request is NonNullable<typeof request> => request !== null);

  if (requests.length === 0) {
    return new Map();
  }

  const resultsByRowKey = new Map<string, Record<string, string>>();

  for (let index = 0; index < requests.length; index += 10) {
    const requestChunk = requests.slice(index, index + 10);

    try {
      const results: CreatorProfileEnrichmentResult[] = await enrichCreatorProfilesWithOpenAi({
        requests: requestChunk,
        dropdownOptions: {
          "Influencer Type": input.dropdownOptions.influencerType,
          "Influencer Vertical": input.dropdownOptions.influencerVertical,
          "Country/Region": input.dropdownOptions.countryRegion,
          Language: input.dropdownOptions.language,
        },
      });

      for (const result of results) {
        resultsByRowKey.set(result.rowKey, result.values);
      }
    } catch {
      // Creator profile enrichment is best-effort; static and YouTube enrichment still complete.
    }
  }

  return resultsByRowKey;
}

function toNameCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function deriveNamesFromEmail(email: string): { firstName: string; lastName: string } | null {
  const localPart = email.trim().split("@")[0]?.split("+")[0] ?? "";
  const parts = localPart
    .split(/[._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length !== 2) {
    return null;
  }

  const blockedParts = new Set([
    "admin",
    "business",
    "booking",
    "brand",
    "collab",
    "contact",
    "creator",
    "hello",
    "info",
    "mail",
    "marketing",
    "official",
    "partnerships",
    "press",
    "support",
    "team",
    "youtube",
  ]);

  if (
    parts.some((part) => !/^[a-z]{2,24}$/i.test(part))
    || parts.some((part) => blockedParts.has(part.toLowerCase()))
  ) {
    return null;
  }

  const [firstName, lastName] = parts;

  return {
    firstName: toNameCase(firstName ?? ""),
    lastName: toNameCase(lastName ?? ""),
  };
}

function normalizeProfileNameCandidate(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");

  if (!normalized || normalized.length > 60) {
    return "";
  }

  if (/@|https?:\/\/|www\.|\d/u.test(normalized)) {
    return "";
  }

  if (!/^\p{L}[\p{L}' -]*$/u.test(normalized)) {
    return "";
  }

  return normalized;
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

  if (partialMatches.length === 1) {
    return partialMatches[0] ?? "";
  }

  return "";
}

type HubspotFallbackRow = {
  rowKey: string;
  channel: RunPreviewRecord["results"][number]["channel"];
  fallbackValues: Record<string, string>;
};

const HUBSPOT_DIRECT_ENRICHMENT_DROPDOWN_FIELDS = [
  "influencerType",
  "influencerVertical",
  "countryRegion",
  "language",
] as const;

type HubspotDirectEnrichmentDropdownField =
  (typeof HUBSPOT_DIRECT_ENRICHMENT_DROPDOWN_FIELDS)[number];

async function getRunPreview(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
}): Promise<RunPreviewRecord> {
  const run = await prisma.runRequest.findUnique({
    where: { id: input.runId },
    select: runPreviewSelect,
  });

  if (!run) {
    throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found");
  }

  if (input.role !== "admin" && run.requestedByUserId !== input.userId) {
    throw new ServiceError("RUN_FORBIDDEN", 403, "Forbidden");
  }

  return run;
}

function buildHubspotFallbackRows(run: RunPreviewRecord): HubspotFallbackRow[] {
  const fallbackRows: HubspotFallbackRow[] = [];

  for (const result of run.results) {
    const channel = result.channel;
    const contacts =
      channel.contacts.length > 0
        ? channel.contacts
        : [{ email: "", firstName: "", lastName: "" }];
    const youtubeValues = getCreatorListYoutubeValues(channel.youtubeContext?.context ?? null);

    for (const [contactIndex, contact] of contacts.entries()) {
      const rowKey = buildHubspotRowKey({
        resultId: result.id,
        contactEmail: contact.email,
        contactIndex,
      });

      fallbackRows.push({
        rowKey,
        channel,
        fallbackValues: {
          channelId: channel.id,
          channelTitle: channel.title,
          contactType: "Influencer",
          campaignName: run.campaignName ?? "",
          month: normalizeMonth(run.month),
          year: toText(run.year),
          clientName: run.client ?? "",
          dealOwner: run.dealOwner ?? "",
          dealName: `${getPreferredCreatorLabel(channel)} - ${run.campaignName ?? ""}`.trim(),
          activationName: `${getPreferredCreatorLabel(channel)} - ${run.campaignName ?? ""}`.trim(),
          pipeline: run.pipeline ?? "",
          dealStage: run.dealStage ?? "",
          currency: run.currency ?? "",
          dealType: run.dealType ?? "",
          activationType: run.activationType ?? "",
          firstName: contact.firstName ?? "",
          lastName: contact.lastName ?? "",
          email: contact.email,
          phoneNumber: "",
          influencerType: resolveHubspotInfluencerTypeFallback({
            channelInfluencerType: channel.influencerType,
            runHubspotInfluencerType: run.hubspotInfluencerType,
          }),
          influencerVertical: channel.influencerVertical ?? getHubspotInfluencerVertical(channel),
          countryRegion: channel.countryRegion ?? getHubspotCountryRegion(channel),
          language: channel.contentLanguage ?? run.hubspotLanguage ?? getHubspotLanguage(channel),
          youtubeHandle: getPreferredYoutubeHandle(channel),
          youtubeUrl: getPreferredYoutubeUrl(channel),
          youtubeVideoMedianViews: youtubeValues.youtubeVideoMedianViews,
          youtubeShortsMedianViews: youtubeValues.youtubeShortsMedianViews,
          youtubeEngagementRate:
            youtubeValues.youtubeEngagementRate || toText(channel.metrics?.youtubeEngagementRate),
          youtubeFollowers:
            toText(channel.metrics?.youtubeFollowers)
            || toText(
              getParsedYoutubeContext(channel.youtubeContext?.context ?? null)?.subscriberCount,
            ),
          instagramHandle: "",
          instagramUrl: "",
          instagramPostAverageViews: "",
          instagramReelAverageViews: "",
          instagramStory7DayAverageViews: "",
          instagramStory30DayAverageViews: "",
          instagramEngagementRate: "",
          instagramFollowers: "",
          tiktokHandle: "",
          tiktokUrl: "",
          tiktokAverageViews: "",
          tiktokEngagementRate: "",
          tiktokFollowers: "",
          twitchHandle: "",
          twitchUrl: "",
          twitchAverageViews: "",
          twitchEngagementRate: "",
          twitchFollowers: "",
          kickHandle: "",
          kickUrl: "",
          kickAverageViews: "",
          kickEngagementRate: "",
          kickFollowers: "",
          xHandle: "",
          xUrl: "",
          xAverageViews: "",
          xEngagementRate: "",
          xFollowers: "",
        },
      });
    }
  }

  return fallbackRows;
}

function sanitizeHubspotDropdownRowValue(
  field: HubspotDirectEnrichmentDropdownField | "currency" | "dealType" | "activationType",
  value: string,
  dropdownOptions: Awaited<ReturnType<typeof listDropdownOptions>>,
): string {
  if (field === "influencerVertical") {
    return coerceDropdownMultiselectOption(dropdownOptions[field], value);
  }

  return coerceDropdownOption(dropdownOptions[field], value);
}

function sanitizeHubspotRows(
  rows: ExportPreviewRow[],
  dropdownOptions: Awaited<ReturnType<typeof listDropdownOptions>>,
): ExportPreviewRow[] {
  const dropdownFields = [
    "currency",
    "dealType",
    "activationType",
    ...HUBSPOT_DIRECT_ENRICHMENT_DROPDOWN_FIELDS,
  ] as const;

  return rows.map((row) => ({
    ...row,
    values: {
      ...row.values,
      ...Object.fromEntries(dropdownFields.map((field) => [
        field,
        sanitizeHubspotDropdownRowValue(field, row.values[field] ?? "", dropdownOptions),
      ])),
    },
  }));
}

function buildHubspotRows(
  run: RunPreviewRecord,
  dropdownOptions?: Awaited<ReturnType<typeof listDropdownOptions>>,
): ExportPreviewRow[] {
  const fallbackRows = buildHubspotFallbackRows(run);

  const rows = applyHubspotPreparationRows({
    run: {
      currency: run.currency,
      dealType: run.dealType,
      activationType: run.activationType,
      hubspotInfluencerType: run.hubspotInfluencerType,
      hubspotInfluencerVertical: run.hubspotInfluencerVertical,
      hubspotCountryRegion: run.hubspotCountryRegion,
      hubspotLanguage: run.hubspotLanguage,
      rowOverrides: run.hubspotRowOverrides,
    },
    rows: fallbackRows.map((row) => ({
      rowKey: row.rowKey,
      fallbackValues: row.fallbackValues,
    })),
  });

  return dropdownOptions ? sanitizeHubspotRows(rows, dropdownOptions) : rows;
}

function buildValidationIssues(rows: ExportPreviewRow[]): ExportPreviewValidationIssue[] {
  const requiredKeys = HUBSPOT_COLUMNS.filter((column) => column.required).map((column) => column.key);
  const issues: ExportPreviewValidationIssue[] = [];

  for (const row of rows) {
    for (const key of requiredKeys) {
      if (!row.values[key]?.trim()) {
        const label = HUBSPOT_COLUMNS.find((column) => column.key === key)?.label ?? key;
        issues.push({
          rowId: row.id,
          columnKey: key,
          message: `${label} is required`,
        });
      }
    }
  }

  return issues;
}

function buildHubspotRowOverridePatches(input: {
  run: RunPreviewRecord;
  rows: ExportPreviewRow[];
  dropdownOptions: Awaited<ReturnType<typeof listDropdownOptions>>;
  profileResultsByRowKey?: Map<string, Record<string, string>>;
  pageSignalsByChannelId?: Map<string, YoutubeChannelPageEmailSignal>;
}): Array<{
  rowKey: string;
  values: Partial<Record<
    | "firstName"
    | "lastName"
    | "email"
    | "phoneNumber"
    | HubspotDirectEnrichmentDropdownField,
    string
  >>;
}> {
  const rowsByRowKey = new Map(input.rows.map((row) => [row.rowKey, row]));
  const overridesByRowKey = new Map(
    input.run.hubspotRowOverrides.map((override) => [override.rowKey, override]),
  );
  const fallbackRows = buildHubspotFallbackRows(input.run);
  const patches: Array<{
    rowKey: string;
    values: Partial<Record<
      | "firstName"
      | "lastName"
      | "email"
      | "phoneNumber"
      | HubspotDirectEnrichmentDropdownField,
      string
    >>;
  }> = [];

  for (const fallbackRow of fallbackRows) {
    const row = rowsByRowKey.get(fallbackRow.rowKey);

    if (!row) {
      continue;
    }

    const currentOverride = overridesByRowKey.get(fallbackRow.rowKey);
    const values: Partial<Record<
      | "firstName"
      | "lastName"
      | "email"
      | "phoneNumber"
      | HubspotDirectEnrichmentDropdownField,
      string
    >> = {};

    const currentEmail = row.values.email ?? "";
    const currentFirstName = row.values.firstName ?? "";
    const currentLastName = row.values.lastName ?? "";
    const currentPhoneNumber = row.values.phoneNumber ?? "";
    const profileResult = input.profileResultsByRowKey?.get(fallbackRow.rowKey);
    const pageSignal = input.pageSignalsByChannelId?.get(fallbackRow.channel.id) ?? null;
    const profileEmail = extractExplicitEmailsFromText(
      getProfileResultValue(profileResult, "email"),
    )[0] ?? "";
    const preferredEmail =
      currentEmail.trim()
      || getPreferredCreatorEmail(fallbackRow.channel, pageSignal)
      || profileEmail;
    const preferredPhoneNumber = getPreferredCreatorPhoneNumber(fallbackRow.channel, pageSignal);

    if (
      !currentOverride?.email?.trim()
      && !currentEmail.trim()
      && preferredEmail
    ) {
      values.email = preferredEmail;
    }

    const derivedNames = preferredEmail ? deriveNamesFromEmail(preferredEmail) : null;

    if (derivedNames) {
      if (!currentOverride?.firstName?.trim() && !currentFirstName.trim()) {
        values.firstName = derivedNames.firstName;
      }

      if (!currentOverride?.lastName?.trim() && !currentLastName.trim()) {
        values.lastName = derivedNames.lastName;
      }
    }

    const profileFirstName = normalizeProfileNameCandidate(
      getProfileResultValue(profileResult, "firstName"),
    );
    const profileLastName = normalizeProfileNameCandidate(
      getProfileResultValue(profileResult, "lastName"),
    );

    if (
      profileFirstName
      && profileLastName
      && !values.firstName?.trim()
      && !currentOverride?.firstName?.trim()
      && !currentFirstName.trim()
    ) {
      values.firstName = profileFirstName;
    }

    if (
      profileFirstName
      && profileLastName
      && !values.lastName?.trim()
      && !currentOverride?.lastName?.trim()
      && !currentLastName.trim()
    ) {
      values.lastName = profileLastName;
    }

    if (
      !currentOverride?.phoneNumber?.trim()
      && !currentPhoneNumber.trim()
      && preferredPhoneNumber
    ) {
      values.phoneNumber = preferredPhoneNumber;
    }

    for (const field of HUBSPOT_DIRECT_ENRICHMENT_DROPDOWN_FIELDS) {
      const currentOverrideValue = currentOverride?.[field]?.trim() ?? "";
      const rowValue = row.values[field]?.trim() ?? "";
      const options = input.dropdownOptions[field];

      if (currentOverrideValue) {
        continue;
      }

      const normalizedRowValue = field === "influencerVertical"
        ? coerceDropdownMultiselectOption(options, rowValue)
        : coerceDropdownOption(options, rowValue);

      if (rowValue && normalizedRowValue === rowValue) {
        continue;
      }

      const fallbackValue = field === "influencerVertical"
        ? coerceDropdownMultiselectOption(options, fallbackRow.fallbackValues[field] ?? "")
        : coerceDropdownOption(options, fallbackRow.fallbackValues[field] ?? "");
      const profileValue = field === "influencerVertical"
        ? coerceDropdownMultiselectOption(options, getProfileResultValue(profileResult, field))
        : coerceDropdownOption(options, getProfileResultValue(profileResult, field));
      const suggestedValue = normalizedRowValue || fallbackValue || profileValue;

      if (!suggestedValue || row.values[field]?.trim() === suggestedValue) {
        continue;
      }

      values[field] = suggestedValue;
    }

    if (Object.keys(values).length === 0) {
      continue;
    }

    patches.push({
      rowKey: fallbackRow.rowKey,
      values,
    });
  }

  return patches;
}

async function applyHubspotRowOverridePatches(input: {
  runId: string;
  patches: Array<{
    rowKey: string;
    values: Partial<Record<
      | "firstName"
      | "lastName"
      | "email"
      | "phoneNumber"
      | HubspotDirectEnrichmentDropdownField,
      string
    >>;
  }>;
}): Promise<void> {
  if (input.patches.length === 0) {
    return;
  }

  await withDbTransaction(async (tx) => {
    const run = await tx.runRequest.findUnique({
      where: {
        id: input.runId,
      },
      select: {
        id: true,
        hubspotRowOverrides: {
          select: {
            id: true,
            rowKey: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            influencerType: true,
            influencerVertical: true,
            countryRegion: true,
            language: true,
          },
        },
      },
    });

    if (!run) {
      throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found");
    }

    const overridesByRowKey = new Map(run.hubspotRowOverrides.map((row) => [row.rowKey, row]));

    for (const patch of input.patches) {
      const current = overridesByRowKey.get(patch.rowKey);
      const nextValues = Object.fromEntries(
        Object.entries(patch.values).filter(([, value]) => value?.trim()),
      );

      if (Object.keys(nextValues).length === 0) {
        continue;
      }

      if (current) {
        await tx.runHubspotRowOverride.update({
          where: {
            id: current.id,
          },
          data: nextValues,
        });
        continue;
      }

      await tx.runHubspotRowOverride.create({
        data: {
          runRequestId: run.id,
          rowKey: patch.rowKey,
          ...nextValues,
        },
      });
    }
  });
}

function buildHubspotPreviewChangeCounts(input: {
  before: HubspotExportPreview;
  after: HubspotExportPreview;
}): { updatedRowCount: number; updatedFieldCount: number } {
  const beforeRowsByRowKey = new Map(input.before.rows.map((row) => [row.rowKey, row]));
  let updatedRowCount = 0;
  let updatedFieldCount = 0;

  for (const afterRow of input.after.rows) {
    const beforeRow = beforeRowsByRowKey.get(afterRow.rowKey);
    let rowChanged = false;

    for (const column of input.after.columns) {
      const beforeValue = beforeRow?.values[column.key] ?? "";
      const afterValue = afterRow.values[column.key] ?? "";

      if (beforeValue === afterValue) {
        continue;
      }

      rowChanged = true;

      if (!beforeValue.trim() && afterValue.trim()) {
        updatedFieldCount += 1;
      }
    }

    if (rowChanged) {
      updatedRowCount += 1;
    }
  }

  return {
    updatedRowCount,
    updatedFieldCount,
  };
}

async function updateHubspotPreviewEnrichmentJobProgress(input: {
  jobId: string;
  progressPercentage: number;
  progressMessage: string;
  processedChannelCount?: number;
  failedChannelCount?: number;
}): Promise<void> {
  await prisma.hubspotPreviewEnrichmentJob.update({
    where: {
      id: input.jobId,
    },
    data: {
      progressPercentage: Math.min(100, Math.max(0, input.progressPercentage)),
      progressMessage: input.progressMessage,
      ...(input.processedChannelCount === undefined
        ? {}
        : { processedChannelCount: input.processedChannelCount }),
      ...(input.failedChannelCount === undefined
        ? {}
        : { failedChannelCount: input.failedChannelCount }),
    },
  });
}

async function refreshCreatorListYoutubeSignals(input: {
  channel: RunPreviewRecord["results"][number]["channel"];
  youtubeApiKey: string;
}): Promise<YoutubeChannelContext> {
  const context = normalizeYoutubeContext(await fetchYoutubeChannelContext({
    apiKey: input.youtubeApiKey,
    channelId: input.channel.youtubeChannelId,
    maxVideos: 50,
    minLongFormVideos: 50,
  }));
  const normalizedHandle = normalizeYoutubeHandle(context.handle);
  const canonicalUrl = buildCanonicalYoutubeUrl(input.channel.youtubeChannelId, normalizedHandle);
  const metrics = deriveCreatorListYoutubeMetrics(context);
  const fetchedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.channelYoutubeContext.upsert({
      where: {
        channelId: input.channel.id,
      },
      create: {
        channelId: input.channel.id,
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

    await tx.channel.update({
      where: {
        id: input.channel.id,
      },
      data: {
        handle: normalizedHandle,
        youtubeUrl: canonicalUrl,
        description: input.channel.description ?? context.description,
        thumbnailUrl: context.thumbnailUrl,
        contentLanguage: mapYoutubeLanguageToHubspot(context.defaultLanguage ?? "") || null,
      },
    });

    await tx.channelMetric.upsert({
      where: {
        channelId: input.channel.id,
      },
      create: {
        channelId: input.channel.id,
        subscriberCount: toNullableBigInt(context.subscriberCount),
        viewCount: toNullableBigInt(context.viewCount),
        videoCount: toNullableBigInt(context.videoCount),
        youtubeEngagementRate: metrics.medianVideoEngagementRate,
        youtubeFollowers: toNullableBigInt(context.subscriberCount),
        youtubeVideoMedianViews: toNullableBigInt(metrics.medianVideoViews),
        youtubeShortsMedianViews: toNullableBigInt(metrics.medianShortsViews),
      },
      update: {
        subscriberCount: toNullableBigInt(context.subscriberCount),
        viewCount: toNullableBigInt(context.viewCount),
        videoCount: toNullableBigInt(context.videoCount),
        youtubeEngagementRate: metrics.medianVideoEngagementRate,
        youtubeFollowers: toNullableBigInt(context.subscriberCount),
        youtubeVideoMedianViews: toNullableBigInt(metrics.medianVideoViews),
        youtubeShortsMedianViews: toNullableBigInt(metrics.medianShortsViews),
      },
    });
  });

  return context;
}

async function fetchCreatorPageSignals(
  run: RunPreviewRecord,
): Promise<Map<string, YoutubeChannelPageEmailSignal>> {
  const signalsByChannelId = new Map<string, YoutubeChannelPageEmailSignal>();
  const channels = [...new Map(
    run.results.map((result) => [result.channel.id, result.channel]),
  ).values()];

  await Promise.all(
    channels.map(async (channel) => {
      try {
        const signal = await fetchYoutubeChannelPageEmailSignal({
          canonicalUrl: getPreferredYoutubeUrl(channel),
        });

        if (signal.emails.length > 0 || signal.snippet) {
          signalsByChannelId.set(channel.id, signal);
        }
      } catch {
        // Page scraping is best-effort; YouTube API and direct row evidence remain authoritative.
      }
    }),
  );

  return signalsByChannelId;
}

export async function createHubspotPreviewEnrichmentJob(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
  actorUserId: string;
}): Promise<HubspotPreviewEnrichmentJobSummary> {
  const run = await getRunPreview({
    runId: input.runId,
    userId: input.userId,
    role: input.role,
  });
  let jobId = "";

  await withDbTransaction(async (tx) => {
    const job = await tx.hubspotPreviewEnrichmentJob.create({
      data: {
        runRequestId: run.id,
        requestedByUserId: input.actorUserId,
        progressPercentage: 0,
        progressMessage: "Creator List enrichment queued.",
      },
      select: {
        id: true,
      },
    });
    jobId = job.id;

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "hubspot_prep.enrichment.requested",
        entityType: "hubspot_preview_enrichment_job",
        entityId: job.id,
        metadata: {
          runId: run.id,
        },
      },
    });
  });

  try {
    await enqueueJob("hubspot-preview.enrich", {
      enrichmentJobId: jobId,
      requestedByUserId: input.actorUserId,
    });
  } catch (error) {
    await prisma.hubspotPreviewEnrichmentJob.update({
      where: {
        id: jobId,
      },
      data: {
        status: PrismaHubspotPreviewEnrichmentJobStatus.FAILED,
        completedAt: new Date(),
        lastError: formatErrorMessage(error),
        progressPercentage: 100,
        progressMessage: "Creator List enrichment could not be queued.",
      },
    });

    throw new ServiceError(
      "HUBSPOT_PREVIEW_ENRICHMENT_ENQUEUE_FAILED",
      500,
      "Failed to enqueue Creator List enrichment",
    );
  }

  return getHubspotPreviewEnrichmentJob({
    runId: input.runId,
    enrichmentJobId: jobId,
    userId: input.userId,
    role: input.role,
  });
}

export async function getHubspotPreviewEnrichmentJob(input: {
  runId: string;
  enrichmentJobId: string;
  userId: string;
  role: "admin" | "user";
}): Promise<HubspotPreviewEnrichmentJobSummary> {
  const job = await prisma.hubspotPreviewEnrichmentJob.findFirst({
    where: {
      id: input.enrichmentJobId,
      runRequestId: input.runId,
      ...(input.role === "admin"
        ? {}
        : {
            runRequest: {
              requestedByUserId: input.userId,
            },
          }),
    },
    select: hubspotPreviewEnrichmentJobSummarySelect,
  });

  if (!job) {
    throw new ServiceError(
      "HUBSPOT_PREVIEW_ENRICHMENT_JOB_NOT_FOUND",
      404,
      "Creator List enrichment job not found",
    );
  }

  return toHubspotPreviewEnrichmentJobSummary(job);
}

export async function executeHubspotPreviewEnrichmentJob(input: {
  enrichmentJobId: string;
  requestedByUserId: string;
}): Promise<void> {
  const job = await prisma.hubspotPreviewEnrichmentJob.findUnique({
    where: {
      id: input.enrichmentJobId,
    },
    select: {
      id: true,
      runRequestId: true,
      requestedByUserId: true,
    },
  });

  if (!job) {
    return;
  }

  if (job.requestedByUserId !== input.requestedByUserId) {
    await prisma.hubspotPreviewEnrichmentJob.update({
      where: {
        id: job.id,
      },
      data: {
        status: PrismaHubspotPreviewEnrichmentJobStatus.FAILED,
        progressPercentage: 100,
        progressMessage: "Creator List enrichment failed.",
        completedAt: new Date(),
        lastError: "Creator List enrichment payload user mismatch",
      },
    });
    return;
  }

  const claimed = await prisma.hubspotPreviewEnrichmentJob.updateMany({
    where: {
      id: job.id,
      status: {
        in: [
          PrismaHubspotPreviewEnrichmentJobStatus.QUEUED,
          PrismaHubspotPreviewEnrichmentJobStatus.FAILED,
        ],
      },
    },
    data: {
      status: PrismaHubspotPreviewEnrichmentJobStatus.RUNNING,
      progressPercentage: 2,
      progressMessage: "Starting Creator List enrichment...",
      startedAt: new Date(),
      completedAt: null,
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  try {
    const youtubeApiKey = await getUserYoutubeApiKey(job.requestedByUserId);

    if (!youtubeApiKey) {
      throw new ServiceError(
        "YOUTUBE_KEY_REQUIRED",
        400,
        "Assigned YouTube API key is required before enriching Creator List rows",
      );
    }

    const [beforePreview, initialRun] = await Promise.all([
      getHubspotExportPreview({
        runId: job.runRequestId,
        userId: job.requestedByUserId,
        role: "admin",
      }),
      getRunPreview({
        runId: job.runRequestId,
        userId: job.requestedByUserId,
        role: "admin",
      }),
    ]);
    const channelsToProcess = [...new Map(
      initialRun.results
        .map((result) => result.channel)
        .map((channel) => [channel.id, channel]),
    ).values()];
    let failedChannelCount = 0;

    await updateHubspotPreviewEnrichmentJobProgress({
      jobId: job.id,
      progressPercentage: 8,
      progressMessage: `Refreshing YouTube signals for ${channelsToProcess.length} channel${channelsToProcess.length === 1 ? "" : "s"}...`,
      processedChannelCount: 0,
      failedChannelCount,
    });

    for (const [index, channel] of channelsToProcess.entries()) {
      await updateHubspotPreviewEnrichmentJobProgress({
        jobId: job.id,
        progressPercentage:
          10 + Math.round(((index + 1) / Math.max(channelsToProcess.length, 1)) * 60),
        progressMessage: `Refreshing creator signals for ${channel.title} (${index + 1}/${channelsToProcess.length})...`,
        processedChannelCount: index,
        failedChannelCount,
      });

      try {
        await refreshCreatorListYoutubeSignals({
          channel,
          youtubeApiKey,
        });
      } catch (error) {
        failedChannelCount += 1;

        if (isYoutubeChannelContextProviderError(error)) {
          await prisma.channelYoutubeContext.upsert({
            where: {
              channelId: channel.id,
            },
            create: {
              channelId: channel.id,
              context: Prisma.DbNull,
              fetchedAt: null,
              lastError: error.message,
            },
            update: {
              lastError: error.message,
            },
          });
        }
      }
    }

    await updateHubspotPreviewEnrichmentJobProgress({
      jobId: job.id,
      progressPercentage: 76,
      progressMessage: "Applying Creator List row enrichment...",
      processedChannelCount: channelsToProcess.length,
      failedChannelCount,
    });

    const [runAfterRefresh, dropdownOptions] = await Promise.all([
      getRunPreview({
        runId: job.runRequestId,
        userId: job.requestedByUserId,
        role: "admin",
      }),
      listDropdownOptions(),
    ]);
    const previewAfterRefreshRows = buildHubspotRows(runAfterRefresh, dropdownOptions);
    const pageSignalsByChannelId = await fetchCreatorPageSignals(runAfterRefresh);
    const profileResultsByRowKey = await enrichCreatorProfileRowsBestEffort({
      run: runAfterRefresh,
      rows: previewAfterRefreshRows,
      dropdownOptions,
      pageSignalsByChannelId,
    });
    const rowPatches = buildHubspotRowOverridePatches({
      run: runAfterRefresh,
      rows: previewAfterRefreshRows,
      dropdownOptions,
      profileResultsByRowKey,
      pageSignalsByChannelId,
    });

    await applyHubspotRowOverridePatches({
      runId: job.runRequestId,
      patches: rowPatches,
    });

    const afterPreview = await getHubspotExportPreview({
      runId: job.runRequestId,
      userId: job.requestedByUserId,
      role: "admin",
    });
    const counts = buildHubspotPreviewChangeCounts({
      before: beforePreview,
      after: afterPreview,
    });

    await prisma.hubspotPreviewEnrichmentJob.update({
      where: {
        id: job.id,
      },
      data: {
        status: PrismaHubspotPreviewEnrichmentJobStatus.COMPLETED,
        progressPercentage: 100,
        progressMessage: "Creator List enrichment complete.",
        processedChannelCount: channelsToProcess.length,
        updatedRowCount: counts.updatedRowCount,
        updatedFieldCount: counts.updatedFieldCount,
        failedChannelCount,
        completedAt: new Date(),
        lastError: null,
      },
    });

    await prisma.auditEvent.create({
      data: {
        actorUserId: job.requestedByUserId,
        action: "hubspot_prep.enrichment.completed",
        entityType: "hubspot_preview_enrichment_job",
        entityId: job.id,
        metadata: {
          runId: job.runRequestId,
          processedChannelCount: channelsToProcess.length,
          updatedRowCount: counts.updatedRowCount,
          updatedFieldCount: counts.updatedFieldCount,
          failedChannelCount,
        },
      },
    });
  } catch (error) {
    const lastError = formatErrorMessage(error);

    await prisma.hubspotPreviewEnrichmentJob.update({
      where: {
        id: job.id,
      },
      data: {
        status: PrismaHubspotPreviewEnrichmentJobStatus.FAILED,
        progressPercentage: 100,
        progressMessage: "Creator List enrichment failed.",
        completedAt: new Date(),
        lastError,
      },
    });

    await prisma.auditEvent.create({
      data: {
        actorUserId: job.requestedByUserId,
        action: "hubspot_prep.enrichment.failed",
        entityType: "hubspot_preview_enrichment_job",
        entityId: job.id,
        metadata: {
          runId: job.runRequestId,
          lastError,
        },
      },
    });

    throw error;
  }
}

export async function getHubspotExportPreview(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
}): Promise<HubspotExportPreview> {
  const [run, dropdownOptions] = await Promise.all([getRunPreview(input), listDropdownOptions()]);
  const rows = buildHubspotRows(run, dropdownOptions);

  return {
    run: {
      id: run.id,
      name: run.name,
      campaignName: run.campaignName,
    },
    columns: HUBSPOT_COLUMNS,
    requiredColumnKeys: HUBSPOT_COLUMNS.filter((column) => column.required).map((column) => column.key),
    defaults: normalizeHubspotPrepDefaults({
      currency: run.currency,
      dealType: run.dealType,
      activationType: run.activationType,
      hubspotInfluencerType: run.hubspotInfluencerType,
      hubspotInfluencerVertical: run.hubspotInfluencerVertical,
      hubspotCountryRegion: run.hubspotCountryRegion,
      hubspotLanguage: run.hubspotLanguage,
    }),
    dropdownOptions,
    rows,
    validationIssues: buildValidationIssues(rows),
  };
}

export async function getCsvExportPreview(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
}): Promise<CsvExportPreview> {
  const run = await getRunPreview(input);
  const rows: ExportPreviewRow[] = [];

  for (const result of run.results) {
    const channel = result.channel;
    const primaryContact = channel.contacts[0];

    rows.push({
      id: result.id,
      rowKey: result.id,
      channelId: channel.id,
      channelTitle: channel.title,
      values: {
        runName: run.name,
        campaignName: run.campaignName ?? "",
        clientName: run.client ?? "",
        market: run.market ?? "",
        briefLink: run.briefLink ?? "",
        channelTitle: channel.title,
        email: primaryContact?.email ?? "",
        firstName: primaryContact?.firstName ?? "",
        lastName: primaryContact?.lastName ?? "",
        youtubeHandle: channel.handle ?? "",
        youtubeUrl: channel.youtubeUrl ?? `https://www.youtube.com/channel/${channel.youtubeChannelId}`,
        youtubeEngagementRate: toText(channel.metrics?.youtubeEngagementRate),
        youtubeFollowers: toText(channel.metrics?.youtubeFollowers),
        influencerVertical: channel.influencerVertical ?? getTopTopic(channel.enrichment?.topics ?? null),
        countryRegion: channel.countryRegion ?? getTopCountry(channel.insights?.audienceCountries ?? null),
      },
    });
  }

  return {
    run: {
      id: run.id,
      name: run.name,
      campaignName: run.campaignName,
    },
    columns: CSV_COLUMNS,
    rows,
  };
}
