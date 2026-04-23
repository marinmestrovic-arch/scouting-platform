export const CREATOR_LIST_HUBSPOT_HANDOFF_HEADER = [
  "Channel Name",
  "HubSpot Record ID",
  "Timestamp Imported",
  "Channel URL",
  "Campaign Name",
  "Deal owner",
  "Status",
  "Email",
  "Phone Number",
  "Currency",
  "Deal Type",
  "Contact Type",
  "Month",
  "Year",
  "Client name",
  "Deal name",
  "Activation Name",
  "Pipeline",
  "Deal stage",
  "First Name",
  "Last Name",
  "Influencer Type",
  "Influencer Vertical",
  "Country/Region",
  "Language",
  "YouTube Handle",
  "YouTube URL",
  "YouTube Video Median Views",
  "YouTube Shorts Median Views",
  "YouTube Engagement Rate",
  "YouTube Followers",
  "Instagram Handle",
  "Instagram URL",
  "Instagram Post Average Views",
  "Instagram Reel Average Views",
  "Instagram Story 7-day Average Views",
  "Instagram Story 30-day Average Views",
  "Instagram Engagement Rate",
  "Instagram Followers",
  "TikTok Handle",
  "TikTok URL",
  "TikTok Average Views",
  "TikTok Engagement Rate",
  "TikTok Followers",
  "Twitch Handle",
  "Twitch URL",
  "Twitch Average Views",
  "Twitch Engagement Rate",
  "Twitch Followers",
  "Kick Handle",
  "Kick URL",
  "Kick Average Views",
  "Kick Engagement Rate",
  "Kick Followers",
  "X Handle",
  "X URL",
  "X Average Views",
  "X Engagement Rate",
  "X Followers",
] as const;

export type CreatorListHubspotHandoffHeader =
  (typeof CREATOR_LIST_HUBSPOT_HANDOFF_HEADER)[number];

export const CREATOR_LIST_HUBSPOT_IMPORT_HEADER = [
  "Channel Name",
  "Channel URL",
  "Email",
  "Phone Number",
  "First Name",
  "Last Name",
  "Influencer Type",
  "Influencer Vertical",
  "Country/Region",
  "Language",
  "YouTube Handle",
  "YouTube URL",
  "YouTube Video Median Views",
  "YouTube Shorts Median Views",
  "YouTube Engagement Rate",
  "YouTube Followers",
  "Instagram Handle",
  "Instagram URL",
  "Instagram Post Average Views",
  "Instagram Reel Average Views",
  "Instagram Story 7-day Average Views",
  "Instagram Story 30-day Average Views",
  "Instagram Engagement Rate",
  "Instagram Followers",
  "TikTok Handle",
  "TikTok URL",
  "TikTok Average Views",
  "TikTok Engagement Rate",
  "TikTok Followers",
  "Twitch Handle",
  "Twitch URL",
  "Twitch Average Views",
  "Twitch Engagement Rate",
  "Twitch Followers",
  "Kick Handle",
  "Kick URL",
  "Kick Average Views",
  "Kick Engagement Rate",
  "Kick Followers",
  "X Handle",
  "X URL",
  "X Average Views",
  "X Engagement Rate",
  "X Followers",
] as const;

export type CreatorListHubspotImportHeader =
  (typeof CREATOR_LIST_HUBSPOT_IMPORT_HEADER)[number];

export const CREATOR_LIST_LEGACY_YOUTUBE_AVERAGE_VIEWS_HEADER = "YouTube Average Views" as const;

export function normalizeCreatorListHubspotHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export const CREATOR_LIST_HUBSPOT_HANDOFF_HEADER_NORMALIZED =
  CREATOR_LIST_HUBSPOT_HANDOFF_HEADER.map(normalizeCreatorListHubspotHeader);

export const CREATOR_LIST_HUBSPOT_HANDOFF_HEADER_NORMALIZED_SET = new Set(
  CREATOR_LIST_HUBSPOT_HANDOFF_HEADER_NORMALIZED,
);

export const CREATOR_LIST_HUBSPOT_HANDOFF_HEADER_BY_NORMALIZED = new Map<
  string,
  CreatorListHubspotHandoffHeader
>(
  CREATOR_LIST_HUBSPOT_HANDOFF_HEADER.map((header) => [
    normalizeCreatorListHubspotHeader(header),
    header,
  ]),
);

export const CREATOR_LIST_HUBSPOT_IMPORT_HEADER_NORMALIZED =
  CREATOR_LIST_HUBSPOT_IMPORT_HEADER.map(normalizeCreatorListHubspotHeader);

export const CREATOR_LIST_HUBSPOT_IMPORT_HEADER_NORMALIZED_SET = new Set(
  CREATOR_LIST_HUBSPOT_IMPORT_HEADER_NORMALIZED,
);

export const CREATOR_LIST_HUBSPOT_IMPORT_HEADER_BY_NORMALIZED = new Map<
  string,
  CreatorListHubspotImportHeader
>(
  CREATOR_LIST_HUBSPOT_IMPORT_HEADER.map((header) => [
    normalizeCreatorListHubspotHeader(header),
    header,
  ]),
);

export const CREATOR_LIST_LEGACY_YOUTUBE_AVERAGE_VIEWS_HEADER_NORMALIZED =
  normalizeCreatorListHubspotHeader(CREATOR_LIST_LEGACY_YOUTUBE_AVERAGE_VIEWS_HEADER);
