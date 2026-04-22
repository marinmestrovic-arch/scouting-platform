import { describe, expect, it } from "vitest";
import type { ChannelStructuredProfile } from "@scouting-platform/contracts";

import { buildHubspotContactProperties } from "./index";

function buildStructuredProfile(
  overrides: {
    root?: Partial<ChannelStructuredProfile>;
    brandSafety?: Partial<ChannelStructuredProfile["brandSafety"]>;
  } = {},
) {
  return {
    primaryNiche: "gaming",
    secondaryNiches: ["tech"],
    contentFormats: ["long_form"],
    brandFitTags: [],
    language: "en",
    geoHints: [],
    sponsorSignals: [],
    brandSafety: {
      status: "low",
      flags: [],
      rationale: "Safe",
      ...overrides.brandSafety,
    },
    ...overrides.root,
  };
}

function makeChannel(
  overrides: Partial<Parameters<typeof buildHubspotContactProperties>[0]> = {},
): Parameters<typeof buildHubspotContactProperties>[0] {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    youtubeChannelId: "UC-HUB-1",
    title: "Creator",
    handle: "@creator",
    youtubeUrl: "https://youtube.com/@creator",
    contentLanguage: null,
    contacts: [{ email: "creator@example.com" }],
    metrics: {
      subscriberCount: 150_000n,
      viewCount: 1_200_000n,
      videoCount: 48n,
      youtubeEngagementRate: 3.5,
      youtubeFollowers: 150_000n,
    },
    enrichment: {
      summary: "Gaming creator",
      topics: ["gaming", "pc builds"],
      brandFitNotes: "Good fit",
      structuredProfile: buildStructuredProfile(),
    },
    insights: {
      audienceInterests: [],
    },
    ...overrides,
  };
}

describe("buildHubspotContactProperties", () => {
  it("maps YouTube metrics to valid HubSpot property names", () => {
    const properties = buildHubspotContactProperties(makeChannel());

    expect(properties).toMatchObject({
      email: "creator@example.com",
      contact_type: "Influencer",
      platforms: "YouTube",
      youtube_url: "https://youtube.com/@creator",
      youtube_handle: "@creator",
      influencer_url: "https://youtube.com/@creator",
      youtube_followers: "150000",
      youtube_engagement_rate: "3.5",
      influencer_size: "Macro (100K - 500K)",
    });
  });

  it("falls back to a channel-id URL when youtubeUrl is null", () => {
    const properties = buildHubspotContactProperties(makeChannel({
      youtubeUrl: null,
      youtubeChannelId: "UCxyz",
    }));

    expect(properties.youtube_url).toBe("https://www.youtube.com/channel/UCxyz");
    expect(properties.influencer_url).toBe("https://www.youtube.com/channel/UCxyz");
  });

  it("returns empty strings for missing metrics", () => {
    const properties = buildHubspotContactProperties(makeChannel({
      metrics: null,
    }));

    expect(properties.youtube_followers).toBe("");
    expect(properties.youtube_engagement_rate).toBe("");
    expect(properties.influencer_size).toBe("");
  });

  it("pushes mapped content language when present", () => {
    const properties = buildHubspotContactProperties(makeChannel({
      contentLanguage: "German",
    }));

    expect(properties.language).toBe("German");
  });

  it("pushes multiple inferred verticals as a HubSpot multi-select string", () => {
    const properties = buildHubspotContactProperties(makeChannel());

    expect(properties.influencer_vertical).toBe("Gaming;Tech");
  });

  it("returns an empty influencer vertical when nothing confidently matches", () => {
    const properties = buildHubspotContactProperties(makeChannel({
      enrichment: {
        summary: "General creator",
        topics: ["obscure niche"],
        brandFitNotes: "",
        structuredProfile: buildStructuredProfile({
          root: {
            primaryNiche: "other",
            secondaryNiches: [],
          },
        }),
      },
      insights: {
        audienceInterests: [{ label: "Something Else", score: 0.2 }],
      },
    }));

    expect(properties.influencer_vertical).toBe("");
  });

  it("keeps specific child verticals without redundant parents", () => {
    const properties = buildHubspotContactProperties(makeChannel({
      enrichment: {
        summary: "Minecraft creator",
        topics: ["minecraft"],
        brandFitNotes: "",
        structuredProfile: buildStructuredProfile({
          root: {
            primaryNiche: "other",
            secondaryNiches: [],
          },
        }),
      },
    }));

    expect(properties.influencer_vertical).toBe("Minecraft");
  });

  it("does not emit the deprecated HubSpot property names", () => {
    const properties = buildHubspotContactProperties(makeChannel());

    expect(properties).not.toHaveProperty("channel_id");
    expect(properties).not.toHaveProperty("youtube_channel_id");
    expect(properties).not.toHaveProperty("creator_title");
    expect(properties).not.toHaveProperty("creator_handle");
    expect(properties).not.toHaveProperty("subscriber_count");
    expect(properties).not.toHaveProperty("view_count");
    expect(properties).not.toHaveProperty("video_count");
    expect(properties).not.toHaveProperty("enrichment_summary");
    expect(properties).not.toHaveProperty("enrichment_topics");
    expect(properties).not.toHaveProperty("brand_fit_notes");
  });
});
