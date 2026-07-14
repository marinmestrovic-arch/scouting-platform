import { ChannelCountrySource } from "@prisma/client";

const protectedCountrySources = new Set<ChannelCountrySource>([
  ChannelCountrySource.ADMIN_MANUAL,
  ChannelCountrySource.CSV_IMPORT,
  ChannelCountrySource.HYPEAUDITOR,
]);

export type ResolvedCountryRegionUpdate = {
  value: string | null;
  source: ChannelCountrySource | null;
};

function getCountryNameFromCode(value: string): string | null {
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

function normalizeComparable(value: string): string {
  const countryName = getCountryNameFromCode(value);

  return (countryName ?? value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/gu, " and ")
    .replace(/\busa\b/giu, "united states")
    .replace(/\bu\.s\.a\.\b/giu, "united states")
    .replace(/\buk\b/giu, "united kingdom")
    .replace(/\bu\.k\.\b/giu, "united kingdom")
    .replace(/\buae\b/giu, "united arab emirates")
    .replace(/\bczech republic\b/giu, "czechia")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ");
}

export function normalizeCountryRegionOption(
  options: readonly string[],
  candidate: string | null | undefined,
): string | null {
  const value = candidate?.trim();

  if (!value) {
    return null;
  }

  const comparable = normalizeComparable(value);

  return options.find((option) => normalizeComparable(option) === comparable) ?? null;
}

export function resolveChannelCountryRegion(input: {
  currentValue: string | null;
  currentSource: ChannelCountrySource | null;
  countryRegionOptions: readonly string[];
  youtubeCountryCode: string | null | undefined;
  llmCountryRegion: string | null | undefined;
}): ResolvedCountryRegionUpdate | null {
  if (input.currentSource && protectedCountrySources.has(input.currentSource)) {
    return null;
  }

  const youtubeCountry = normalizeCountryRegionOption(
    input.countryRegionOptions,
    input.youtubeCountryCode,
  );

  if (youtubeCountry) {
    if (
      input.currentValue === youtubeCountry
      && input.currentSource === ChannelCountrySource.YOUTUBE_DECLARED
    ) {
      return null;
    }

    return {
      value: youtubeCountry,
      source: ChannelCountrySource.YOUTUBE_DECLARED,
    };
  }

  const llmCountry = normalizeCountryRegionOption(
    input.countryRegionOptions,
    input.llmCountryRegion,
  );

  if (llmCountry) {
    if (input.currentValue === llmCountry && input.currentSource === ChannelCountrySource.LLM) {
      return null;
    }

    return {
      value: llmCountry,
      source: ChannelCountrySource.LLM,
    };
  }

  if (input.currentValue || input.currentSource) {
    return {
      value: null,
      source: null,
    };
  }

  return null;
}

export function isProtectedCountrySource(source: ChannelCountrySource | null): boolean {
  return source !== null && protectedCountrySources.has(source);
}
