import { describe, expect, it } from "vitest";

import {
  CREATOR_LIST_HUBSPOT_IMPORT_HEADER,
  CREATOR_LIST_HUBSPOT_IMPORT_HEADER_BY_NORMALIZED,
  CREATOR_LIST_HUBSPOT_IMPORT_HEADER_NORMALIZED_SET,
  CREATOR_LIST_HUBSPOT_HANDOFF_HEADER,
  CREATOR_LIST_HUBSPOT_HANDOFF_HEADER_BY_NORMALIZED,
  CREATOR_LIST_HUBSPOT_HANDOFF_HEADER_NORMALIZED_SET,
  CREATOR_LIST_LEGACY_YOUTUBE_AVERAGE_VIEWS_HEADER,
  CREATOR_LIST_LEGACY_YOUTUBE_AVERAGE_VIEWS_HEADER_NORMALIZED,
  normalizeCreatorListHubspotHeader,
} from "./creator-list";

describe("creator list handoff headers", () => {
  it("exports the canonical v3 creator list and hubspot handoff header order", () => {
    expect(CREATOR_LIST_HUBSPOT_HANDOFF_HEADER).toEqual([
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
    ]);
  });

  it("exports the reduced admin csv import header order", () => {
    expect(CREATOR_LIST_HUBSPOT_IMPORT_HEADER).toEqual([
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
    ]);
  });

  it("normalizes header names and preserves normalized lookup entries", () => {
    const normalized = normalizeCreatorListHubspotHeader("  YouTube   Followers  ");

    expect(normalized).toBe("youtube followers");
    expect(CREATOR_LIST_HUBSPOT_HANDOFF_HEADER_NORMALIZED_SET.has(normalized)).toBe(true);
    expect(CREATOR_LIST_HUBSPOT_IMPORT_HEADER_NORMALIZED_SET.has(normalized)).toBe(true);
    expect(CREATOR_LIST_HUBSPOT_HANDOFF_HEADER_BY_NORMALIZED.get(normalized)).toBe(
      "YouTube Followers",
    );
    expect(CREATOR_LIST_HUBSPOT_IMPORT_HEADER_BY_NORMALIZED.get(normalized)).toBe(
      "YouTube Followers",
    );
  });

  it("marks the legacy youtube average views column as deprecated", () => {
    expect(CREATOR_LIST_LEGACY_YOUTUBE_AVERAGE_VIEWS_HEADER).toBe("YouTube Average Views");
    expect(CREATOR_LIST_LEGACY_YOUTUBE_AVERAGE_VIEWS_HEADER_NORMALIZED).toBe(
      "youtube average views",
    );
  });
});
