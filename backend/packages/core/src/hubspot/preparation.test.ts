import { describe, expect, it } from "vitest";

import {
  buildHubspotCreatorCampaignName,
  buildHubspotRunDefaultsUpdate,
  resolveHubspotCreatorLabel,
  resolveHubspotInfluencerTypeFallback,
} from "./preparation";

describe("HubSpot creator campaign naming", () => {
  it("prefers the channel handle and combines it with the campaign", () => {
    const creatorLabel = resolveHubspotCreatorLabel({
      channelHandle: " @creator ",
      youtubeContextHandle: "@context-creator",
      channelTitle: "Creator title",
    });

    expect(
      buildHubspotCreatorCampaignName({
        creatorLabel,
        campaignName: " Campaign ",
      }),
    ).toBe("@creator - Campaign");
  });

  it("falls back through YouTube context to the channel title", () => {
    expect(
      resolveHubspotCreatorLabel({
        channelHandle: "",
        youtubeContextHandle: " @context-creator ",
        channelTitle: "Creator title",
      }),
    ).toBe("@context-creator");
    expect(
      resolveHubspotCreatorLabel({
        channelHandle: null,
        youtubeContextHandle: " ",
        channelTitle: " Creator title ",
      }),
    ).toBe("Creator title");
  });

  it("does not leave a dangling separator when either part is missing", () => {
    expect(
      buildHubspotCreatorCampaignName({ creatorLabel: "@creator", campaignName: " " }),
    ).toBe("@creator");
    expect(
      buildHubspotCreatorCampaignName({ creatorLabel: null, campaignName: "Campaign" }),
    ).toBe("Campaign");
  });
});

describe("resolveHubspotInfluencerTypeFallback", () => {
  it("prefers the channel value when present", () => {
    expect(
      resolveHubspotInfluencerTypeFallback({
        channelInfluencerType: "Streamer",
        runHubspotInfluencerType: "Creator",
      }),
    ).toBe("Streamer");
  });

  it("falls back to the synced run value when the channel value is blank", () => {
    expect(
      resolveHubspotInfluencerTypeFallback({
        channelInfluencerType: "   ",
        runHubspotInfluencerType: "Male",
      }),
    ).toBe("Male");
  });

  it("returns an empty string when neither source has a configured value", () => {
    expect(
      resolveHubspotInfluencerTypeFallback({
        channelInfluencerType: null,
        runHubspotInfluencerType: undefined,
      }),
    ).toBe("");
  });
});

describe("buildHubspotRunDefaultsUpdate", () => {
  it("updates only the fields exposed in Run defaults", () => {
    const update = buildHubspotRunDefaultsUpdate({
      currency: " EUR ",
      dealType: " Flat Fee ",
      activationType: " YTI (Integration) ",
      influencerType: "Legacy Influencer Type",
      influencerVertical: "Gaming",
      countryRegion: "Croatia",
      language: "Croatian",
    });

    expect(update).toEqual({
      currency: "EUR",
      dealType: "Flat Fee",
      activationType: "YTI (Integration)",
    });
    expect(update).not.toHaveProperty("hubspotInfluencerType");
    expect(update).not.toHaveProperty("influencerType");
  });

  it("normalizes blank run defaults to null", () => {
    expect(
      buildHubspotRunDefaultsUpdate({
        currency: " ",
        dealType: "",
        activationType: "\t",
        influencerType: "Legacy Influencer Type",
        influencerVertical: "",
        countryRegion: "",
        language: "",
      }),
    ).toEqual({
      currency: null,
      dealType: null,
      activationType: null,
    });
  });
});
