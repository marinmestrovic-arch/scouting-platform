import { describe, expect, it } from "vitest";

import {
  buildHubspotRunDefaultsUpdate,
  resolveHubspotInfluencerTypeFallback,
} from "./preparation";

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
