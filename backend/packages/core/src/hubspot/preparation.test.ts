import { describe, expect, it } from "vitest";

import { resolveHubspotInfluencerTypeFallback } from "./preparation";

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
