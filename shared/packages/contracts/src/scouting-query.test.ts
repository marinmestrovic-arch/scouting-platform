import { describe, expect, it } from "vitest";

import {
  buildCatalogScoutingQuery,
  hasCatalogScoutingCriteria,
  isCatalogScoutingQuery,
  normalizeCatalogScoutingCriteria,
  parseCatalogScoutingQuery,
} from "./scouting-query";

describe("scouting query helpers", () => {
  it("normalizes and detects whether any catalog scouting criteria were provided", () => {
    expect(
      normalizeCatalogScoutingCriteria({
        subscribers: " 100K+ ",
        language: " English ",
      }),
    ).toEqual({
      subscribers: "100K+",
      views: "",
      location: "",
      language: "English",
      lastPostDaysSince: "",
      category: "",
      niche: "",
    });
    expect(hasCatalogScoutingCriteria({ subscribers: "  " })).toBe(false);
    expect(hasCatalogScoutingCriteria({ subscribers: "100K+" })).toBe(true);
    expect(hasCatalogScoutingCriteria({ category: "Gaming", niche: "Strategy" })).toBe(true);
  });

  it("builds and parses catalog scouting query strings", () => {
    const query = buildCatalogScoutingQuery({
      subscribers: "100K+",
      views: "25K-250K",
      location: "Germany",
      language: "German",
      lastPostDaysSince: "30",
      category: "Gaming",
      niche: "Strategy",
    });

    expect(isCatalogScoutingQuery(query)).toBe(true);
    expect(parseCatalogScoutingQuery(query)).toEqual({
      subscribers: "100K+",
      views: "25K-250K",
      location: "Germany",
      language: "German",
      lastPostDaysSince: "30",
      category: "Gaming",
      niche: "Strategy",
    });
  });

  it("requires the full structured payload before treating a query as catalog-only", () => {
    expect(isCatalogScoutingQuery("Catalog scouting criteria")).toBe(false);
    expect(
      isCatalogScoutingQuery("Catalog scouting criteria for German gaming channels"),
    ).toBe(false);
    expect(
      parseCatalogScoutingQuery("Catalog scouting criteria | Location: Germany"),
    ).toBeNull();
  });

  it("round-trips escaped delimiters in criteria values", () => {
    const query = buildCatalogScoutingQuery({
      location: "Germany | Austria",
      niche: String.raw`FPS \ Strategy`,
    });

    expect(isCatalogScoutingQuery(query)).toBe(true);
    expect(parseCatalogScoutingQuery(query)).toEqual({
      subscribers: "",
      views: "",
      location: "Germany | Austria",
      language: "",
      lastPostDaysSince: "",
      category: "",
      niche: String.raw`FPS \ Strategy`,
    });
  });
});
