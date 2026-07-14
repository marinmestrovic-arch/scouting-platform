import { ChannelCountrySource } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  normalizeCountryRegionOption,
  resolveChannelCountryRegion,
} from "./country-resolution";

const options = ["Croatia", "Czechia", "United Kingdom", "United States"];

describe("creator country resolution", () => {
  it("maps YouTube country codes to configured dropdown labels", () => {
    expect(normalizeCountryRegionOption(options, "HR")).toBe("Croatia");
    expect(normalizeCountryRegionOption(options, "US")).toBe("United States");
    expect(normalizeCountryRegionOption(options, "GB")).toBe("United Kingdom");
  });

  it("prefers YouTube-declared country over an LLM classification", () => {
    expect(resolveChannelCountryRegion({
      currentValue: "United States",
      currentSource: ChannelCountrySource.LLM,
      countryRegionOptions: options,
      youtubeCountryCode: "HR",
      llmCountryRegion: "United States",
    })).toEqual({
      value: "Croatia",
      source: ChannelCountrySource.YOUTUBE_DECLARED,
    });
  });

  it.each([
    ChannelCountrySource.ADMIN_MANUAL,
    ChannelCountrySource.CSV_IMPORT,
    ChannelCountrySource.HYPEAUDITOR,
  ])("preserves protected %s country values", (source) => {
    expect(resolveChannelCountryRegion({
      currentValue: "United States",
      currentSource: source,
      countryRegionOptions: options,
      youtubeCountryCode: "HR",
      llmCountryRegion: "Croatia",
    })).toBeNull();
  });

  it("uses LLM only when YouTube has no usable declaration", () => {
    expect(resolveChannelCountryRegion({
      currentValue: null,
      currentSource: null,
      countryRegionOptions: options,
      youtubeCountryCode: null,
      llmCountryRegion: "Croatia",
    })).toEqual({
      value: "Croatia",
      source: ChannelCountrySource.LLM,
    });
  });

  it("clears an unverified automated value when neither source supports it", () => {
    expect(resolveChannelCountryRegion({
      currentValue: "United States",
      currentSource: ChannelCountrySource.LLM,
      countryRegionOptions: options,
      youtubeCountryCode: null,
      llmCountryRegion: null,
    })).toEqual({ value: null, source: null });
  });
});
