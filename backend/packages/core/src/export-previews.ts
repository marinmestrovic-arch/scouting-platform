import { RunMonth, type Prisma } from "@prisma/client";
import type {
  CsvExportPreview,
  ExportPreviewColumn,
  ExportPreviewRow,
  ExportPreviewValidationIssue,
  HubspotExportPreview,
} from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";

import { listDropdownOptions } from "./dropdown-values";
import { ServiceError } from "./errors";
import {
  applyHubspotPreparationRows,
  buildHubspotRowKey,
  normalizeHubspotPrepDefaults,
} from "./hubspot/preparation";

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
              youtubeAverageViews: true,
              youtubeEngagementRate: true,
              youtubeFollowers: true,
            },
          },
          enrichment: {
            select: {
              topics: true,
            },
          },
          insights: {
            select: {
              audienceCountries: true,
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
  column("pipeline", "Pipeline", false, true),
  column("dealStage", "Deal stage", false, true),
  column("currency", "Currency", true, true, "dropdown", "currency"),
  column("dealType", "Deal Type", true, true, "dropdown", "dealType"),
  column("activationType", "Activation Type", true, true, "dropdown", "activationType"),
  column("firstName", "First Name", true, true),
  column("lastName", "Last Name", true, true),
  column("email", "Email", true, true),
  column("influencerType", "Influencer Type", true, true, "dropdown", "influencerType"),
  column("influencerVertical", "Influencer Vertical", true, true, "dropdown", "influencerVertical"),
  column("countryRegion", "Country/Region", true, true, "dropdown", "countryRegion"),
  column("language", "Language", true, true, "dropdown", "language"),
  column("youtubeHandle", "YouTube Handle", false),
  column("youtubeUrl", "YouTube URL", false),
  column("youtubeAverageViews", "YouTube Average Views", false),
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
  column("youtubeAverageViews", "YouTube Average Views", false),
  column("youtubeEngagementRate", "YouTube Engagement Rate", false),
  column("youtubeFollowers", "YouTube Followers", false),
  column("influencerVertical", "Influencer Vertical", false),
  column("countryRegion", "Country/Region", false),
];

type RunPreviewRecord = Prisma.RunRequestGetPayload<{ select: typeof runPreviewSelect }>;

function normalizeMonth(value: RunMonth | null): string {
  return value ? `${value.charAt(0)}${value.slice(1).toLowerCase()}` : "";
}

function toText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
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

function buildHubspotRows(run: RunPreviewRecord): ExportPreviewRow[] {
  const fallbackRows: Array<{ rowKey: string; fallbackValues: Record<string, string> }> = [];

  for (const result of run.results) {
    const channel = result.channel;
    const contacts = channel.contacts.length > 0 ? channel.contacts : [{ email: "", firstName: "", lastName: "" }];

    for (const [contactIndex, contact] of contacts.entries()) {
      const rowKey = buildHubspotRowKey({
        resultId: result.id,
        contactEmail: contact.email,
        contactIndex,
      });

      fallbackRows.push({
        rowKey,
        fallbackValues: {
          channelId: channel.id,
          channelTitle: channel.title,
          contactType: "Influencer",
          campaignName: run.campaignName ?? "",
          month: normalizeMonth(run.month),
          year: toText(run.year),
          clientName: run.client ?? "",
          dealOwner: run.dealOwner ?? "",
          dealName: `${channel.title} - ${run.campaignName ?? ""}`.trim(),
          pipeline: run.pipeline ?? "",
          dealStage: run.dealStage ?? "",
          currency: run.currency ?? "",
          dealType: run.dealType ?? "",
          activationType: run.activationType ?? "",
          firstName: contact.firstName ?? "",
          lastName: contact.lastName ?? "",
          email: contact.email,
          influencerType: channel.influencerType ?? run.hubspotInfluencerType ?? "YouTube Creator",
          influencerVertical: channel.influencerVertical ?? getTopTopic(channel.enrichment?.topics ?? null),
          countryRegion: channel.countryRegion ?? getTopCountry(channel.insights?.audienceCountries ?? null),
          language: channel.contentLanguage ?? run.hubspotLanguage ?? "",
          youtubeHandle: channel.handle ?? "",
          youtubeUrl: channel.youtubeUrl ?? `https://www.youtube.com/channel/${channel.youtubeChannelId}`,
          youtubeAverageViews: toText(channel.metrics?.youtubeAverageViews),
          youtubeEngagementRate: toText(channel.metrics?.youtubeEngagementRate),
          youtubeFollowers: toText(channel.metrics?.youtubeFollowers),
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

  return applyHubspotPreparationRows({
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
    rows: fallbackRows,
  });
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

export async function getHubspotExportPreview(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
}): Promise<HubspotExportPreview> {
  const [run, dropdownOptions] = await Promise.all([getRunPreview(input), listDropdownOptions()]);
  const rows = buildHubspotRows(run);

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
        youtubeAverageViews: toText(channel.metrics?.youtubeAverageViews),
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
