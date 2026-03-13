import process from "node:process";

import { z } from "zod";

const hypeAuditorInputSchema = z.object({
  youtubeChannelId: z.string().trim().min(1),
  apiKey: z.string().trim().min(1).optional(),
  baseUrl: z.string().trim().url().default("https://hypeauditor.com"),
  fetchFn: z.custom<typeof fetch>().optional(),
});

const reportResponseSchema = z.object({
  report_state: z.string().trim().min(1),
  report: z.record(z.string(), z.unknown()),
});

const wrappedReportResponseSchema = z.object({
  result: reportResponseSchema,
});

const reportFeaturesEntrySchema = z.object({
  data: z.unknown().optional(),
});

type JsonRecord = Record<string, unknown>;

type FetchLike = typeof fetch;

export type HypeAuditorErrorCode =
  | "HYPEAUDITOR_API_KEY_MISSING"
  | "HYPEAUDITOR_API_KEY_INVALID_FORMAT"
  | "HYPEAUDITOR_AUTH_FAILED"
  | "HYPEAUDITOR_RATE_LIMITED"
  | "HYPEAUDITOR_INVALID_RESPONSE"
  | "HYPEAUDITOR_REPORT_NOT_READY"
  | "HYPEAUDITOR_REPORT_FAILED"
  | "HYPEAUDITOR_REQUEST_FAILED";

export type HypeAuditorAudienceCountry = {
  countryCode: string;
  countryName: string;
  percentage: number;
};

export type HypeAuditorAudienceGenderAge = {
  gender: string;
  ageRange: string;
  percentage: number;
};

export type HypeAuditorAudienceInterest = {
  label: string;
  score: number | null;
};

export type HypeAuditorEstimatedPrice = {
  currencyCode: string | null;
  min: number | null;
  max: number | null;
};

export type HypeAuditorBrandMention = {
  brandName: string;
};

export type HypeAuditorChannelInsights = {
  audienceCountries: HypeAuditorAudienceCountry[];
  audienceGenderAge: HypeAuditorAudienceGenderAge[];
  audienceInterests: HypeAuditorAudienceInterest[];
  estimatedPrice: HypeAuditorEstimatedPrice | null;
  brandMentions: HypeAuditorBrandMention[];
};

export type FetchHypeAuditorChannelInsightsInput = z.input<typeof hypeAuditorInputSchema>;
export type FetchHypeAuditorChannelInsightsResult = {
  insights: HypeAuditorChannelInsights;
  rawPayload: {
    report: JsonRecord;
    brandMentions: unknown;
  };
};

export class HypeAuditorError extends Error {
  readonly code: HypeAuditorErrorCode;
  readonly status: number;

  constructor(code: HypeAuditorErrorCode, status: number, message: string) {
    super(message);
    this.name = "HypeAuditorError";
    this.code = code;
    this.status = status;
  }
}

export function isHypeAuditorError(error: unknown): error is HypeAuditorError {
  return error instanceof HypeAuditorError;
}

function toJsonRecord(value: unknown): JsonRecord {
  return JSON.parse(JSON.stringify(value)) as JsonRecord;
}

function getApiKey(override?: string): string {
  const apiKey = override?.trim() || process.env.HYPEAUDITOR_API_KEY?.trim();

  if (!apiKey) {
    throw new HypeAuditorError(
      "HYPEAUDITOR_API_KEY_MISSING",
      500,
      "HYPEAUDITOR_API_KEY is required for HypeAuditor reports",
    );
  }

  return apiKey;
}

function getCredentials(apiKey: string): { authId: string; authToken: string } {
  const [authId, ...tokenParts] = apiKey.split(":");
  const authToken = tokenParts.join(":").trim();

  if (!authId?.trim() || !authToken) {
    throw new HypeAuditorError(
      "HYPEAUDITOR_API_KEY_INVALID_FORMAT",
      500,
      "HYPEAUDITOR_API_KEY must be formatted as <auth_id>:<auth_token>",
    );
  }

  return {
    authId: authId.trim(),
    authToken,
  };
}

function getFetch(fetchFn?: FetchLike): FetchLike {
  return fetchFn ?? fetch;
}

function toProviderError(response: Response): HypeAuditorError {
  if (response.status === 401 || response.status === 403) {
    return new HypeAuditorError(
      "HYPEAUDITOR_AUTH_FAILED",
      401,
      "HypeAuditor credentials are invalid or unauthorized",
    );
  }

  if (response.status === 429) {
    return new HypeAuditorError(
      "HYPEAUDITOR_RATE_LIMITED",
      429,
      "HypeAuditor rate limit exceeded",
    );
  }

  return new HypeAuditorError(
    "HYPEAUDITOR_REQUEST_FAILED",
    502,
    "HypeAuditor request failed",
  );
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeCountryCode(code: string): string {
  const upper = code.trim().toUpperCase();

  if (upper === "UK") {
    return "GB";
  }

  return upper;
}

function resolveCountryName(code: string): string {
  const normalized = normalizeCountryCode(code);

  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(normalized) ?? code.trim().toUpperCase();
  } catch {
    return code.trim().toUpperCase();
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = Number.parseFloat(value.trim());
    return Number.isFinite(normalized) ? normalized : null;
  }

  return null;
}

function getObject(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function unwrapResult<T>(value: T): T | unknown {
  const container = getObject(value);

  if (!container || !("result" in container)) {
    return value;
  }

  return container.result;
}

function normalizeAudienceCountries(report: JsonRecord): HypeAuditorAudienceCountry[] {
  const featureData = getFeatureData(report, "audience_geo");

  if (Array.isArray(featureData)) {
    return featureData
      .map((item) => {
        const row = getObject(item);

        if (!row) {
          return null;
        }

        const rawCode =
          (typeof row.country_code === "string" && row.country_code.trim()) ||
          (typeof row.code === "string" && row.code.trim()) ||
          (typeof row.title === "string" && row.title.trim()) ||
          null;
        const percentage =
          toNumber(row.prc) ??
          toNumber(row.percentage) ??
          toNumber(row.value) ??
          toNumber(row.score);

        if (!rawCode || percentage === null || percentage <= 0) {
          return null;
        }

        const normalizedCode = normalizeCountryCode(rawCode);

        return {
          countryCode: normalizedCode,
          countryName: resolveCountryName(normalizedCode),
          percentage,
        } satisfies HypeAuditorAudienceCountry;
      })
      .filter((item): item is HypeAuditorAudienceCountry => Boolean(item))
      .sort((left, right) => right.percentage - left.percentage)
      .slice(0, 10);
  }

  const audienceGeo = getObject(report.audience_geo);

  if (!audienceGeo) {
    return [];
  }

  return Object.entries(audienceGeo)
    .map(([countryCode, rawPercentage]) => {
      const percentage = toNumber(rawPercentage);

      if (percentage === null || percentage <= 0) {
        return null;
      }

      const normalizedCode = normalizeCountryCode(countryCode);

      return {
        countryCode: normalizedCode,
        countryName: resolveCountryName(normalizedCode),
        percentage,
      } satisfies HypeAuditorAudienceCountry;
    })
    .filter((item): item is HypeAuditorAudienceCountry => Boolean(item))
    .sort((left, right) => right.percentage - left.percentage)
    .slice(0, 10);
}

function normalizeAudienceGenderAge(report: JsonRecord): HypeAuditorAudienceGenderAge[] {
  const featureData = getFeatureData(report, "audience_age_gender");
  const nestedFeatureMap = getObject(featureData);

  if (nestedFeatureMap) {
    const rows: HypeAuditorAudienceGenderAge[] = [];

    for (const [ageRange, rawValue] of Object.entries(nestedFeatureMap)) {
      const value = getObject(rawValue);

      if (!value) {
        continue;
      }

      for (const gender of ["male", "female"] as const) {
        const percentage = toNumber(value[gender]);

        if (percentage === null || percentage <= 0) {
          continue;
        }

        rows.push({
          gender,
          ageRange: ageRange.trim(),
          percentage,
        });
      }
    }

    if (rows.length > 0) {
      return rows.sort((left, right) => right.percentage - left.percentage);
    }
  }

  if (Array.isArray(featureData)) {
    const rows = featureData
      .flatMap((item) => {
        const row = getObject(item);

        if (!row) {
          return [];
        }

        const ageRange =
          (typeof row.age_range === "string" && row.age_range.trim()) ||
          (typeof row.title === "string" && row.title.trim()) ||
          null;

        if (!ageRange) {
          return [];
        }

        return (["male", "female"] as const)
          .map((gender) => {
            const percentage =
              toNumber(row[gender]) ??
              toNumber(row[`${gender}_percentage`]) ??
              toNumber(row[`${gender}_prc`]);

            if (percentage === null || percentage <= 0) {
              return null;
            }

            return {
              gender,
              ageRange,
              percentage,
            };
          })
          .filter(
            (
              value,
            ): value is { gender: "male" | "female"; ageRange: string; percentage: number } =>
              value !== null,
          );
      });

    if (rows.length > 0) {
      return rows.sort((left, right) => right.percentage - left.percentage);
    }
  }

  const genderMaps = [
    {
      gender: "male",
      values: getObject(report.audience_age_male),
    },
    {
      gender: "female",
      values: getObject(report.audience_age_female),
    },
  ];

  const rows: HypeAuditorAudienceGenderAge[] = [];

  for (const group of genderMaps) {
    if (!group.values) {
      continue;
    }

    for (const [ageRange, rawPercentage] of Object.entries(group.values)) {
      const percentage = toNumber(rawPercentage);

      if (percentage === null || percentage <= 0) {
        continue;
      }

      rows.push({
        gender: group.gender,
        ageRange: ageRange.trim(),
        percentage,
      });
    }
  }

  return rows.sort((left, right) => right.percentage - left.percentage);
}

function getFeatureData(report: JsonRecord, key: string): unknown {
  const features = getObject(report.features);

  if (!features) {
    return undefined;
  }

  const parsed = reportFeaturesEntrySchema.safeParse(features[key]);
  return parsed.success ? parsed.data.data : undefined;
}

function normalizeAudienceInterests(report: JsonRecord): HypeAuditorAudienceInterest[] {
  const direct = getFeatureData(report, "audience_interests");

  if (Array.isArray(direct)) {
    return direct
      .map((item) => {
        const row = getObject(item);

        if (!row) {
          return null;
        }

        const label =
          (typeof row.label === "string" && row.label.trim()) ||
          (typeof row.title === "string" && row.title.trim()) ||
          (typeof row.name === "string" && row.name.trim()) ||
          null;

        if (!label) {
          return null;
        }

        return {
          label,
          score:
            toNumber(row.score) ??
            toNumber(row.value) ??
            toNumber(row.percentage),
        } satisfies HypeAuditorAudienceInterest;
      })
      .filter((item): item is HypeAuditorAudienceInterest => Boolean(item))
      .sort((left, right) => (right.score ?? -1) - (left.score ?? -1))
      .slice(0, 10);
  }

  const directObject = getObject(direct);

  if (!directObject) {
    return [];
  }

  return Object.entries(directObject)
    .map(([label, rawScore]) => {
      const trimmed = label.trim();

      if (!trimmed) {
        return null;
      }

      return {
        label: trimmed,
        score: toNumber(rawScore),
      } satisfies HypeAuditorAudienceInterest;
    })
    .filter((item): item is HypeAuditorAudienceInterest => Boolean(item))
    .sort((left, right) => (right.score ?? -1) - (left.score ?? -1))
    .slice(0, 10);
}

function normalizeEstimatedPrice(report: JsonRecord): HypeAuditorEstimatedPrice | null {
  const rawPriceContainer =
    getObject(getObject(report.video_integration_price)?.data) ??
    getObject(report.video_integration_price);

  if (!rawPriceContainer) {
    return null;
  }

  const price = toNumber(rawPriceContainer.price);
  const min = toNumber(rawPriceContainer.min) ?? toNumber(rawPriceContainer.low);
  const max = toNumber(rawPriceContainer.max) ?? toNumber(rawPriceContainer.high);
  const currencyCode =
    (typeof rawPriceContainer.currency_code === "string" &&
      rawPriceContainer.currency_code.trim()) ||
    (typeof rawPriceContainer.currency === "string" &&
      rawPriceContainer.currency.trim()) ||
    null;

  const resolvedMin = min ?? price;
  const resolvedMax = max ?? price;

  if (resolvedMin === null && resolvedMax === null && !currencyCode) {
    return null;
  }

  return {
    currencyCode: currencyCode ? currencyCode.toUpperCase() : null,
    min: resolvedMin,
    max: resolvedMax,
  };
}

function normalizeBrandMentions(payload: unknown): HypeAuditorBrandMention[] {
  const unwrappedPayload = unwrapResult(payload);
  const container = getObject(unwrappedPayload);
  const candidates = Array.isArray(container?.items)
    ? container.items
    : Array.isArray(container?.results)
      ? container.results
      : Array.isArray(container?.mentions)
        ? container.mentions
      : Array.isArray(unwrappedPayload)
        ? unwrappedPayload
        : Array.isArray(payload)
          ? payload
        : [];
  const seen = new Set<string>();
  const normalized: HypeAuditorBrandMention[] = [];

  for (const candidate of candidates) {
    const row = getObject(candidate);

    if (!row) {
      continue;
    }

    const nestedBrand = getObject(row.brand);
    const nestedBasic = getObject(row.basic);
    const brandName =
      (typeof row.title === "string" && row.title.trim()) ||
      (typeof row.brand_name === "string" && row.brand_name.trim()) ||
      (typeof nestedBasic?.title === "string" && nestedBasic.title.trim()) ||
      (typeof nestedBrand?.title === "string" && nestedBrand.title.trim()) ||
      null;

    if (!brandName) {
      continue;
    }

    const dedupeKey = brandName.toLowerCase();

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({ brandName });

    if (normalized.length >= 20) {
      break;
    }
  }

  return normalized;
}

function assertReportReady(response: z.output<typeof reportResponseSchema>): void {
  const state = response.report_state.trim().toLowerCase();

  if (["failed", "error"].includes(state)) {
    throw new HypeAuditorError(
      "HYPEAUDITOR_REPORT_FAILED",
      502,
      "HypeAuditor report generation failed",
    );
  }

  if (["queued", "pending", "processing", "in_progress"].includes(state)) {
    throw new HypeAuditorError(
      "HYPEAUDITOR_REPORT_NOT_READY",
      503,
      "HypeAuditor report is still processing",
    );
  }

  if (state === "not_ready") {
    throw new HypeAuditorError(
      "HYPEAUDITOR_REPORT_NOT_READY",
      503,
      "HypeAuditor report is still processing",
    );
  }
}

async function fetchReport(input: {
  youtubeChannelId: string;
  baseUrl: string;
  authId: string;
  authToken: string;
  fetchFn: FetchLike;
}): Promise<z.output<typeof reportResponseSchema>> {
  const endpoints = [
    "/api/method/auditor.youtube/",
    "/api/method/auditor.report/",
  ] as const;

  for (const endpoint of endpoints) {
    const response = await input.fetchFn(
      `${input.baseUrl.replace(/\/$/, "")}${endpoint}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-auth-id": input.authId,
          "x-auth-token": input.authToken,
        },
        body: new URLSearchParams({
          channel: input.youtubeChannelId,
        }),
      },
    );

    if (response.status === 404 && endpoint !== endpoints.at(-1)) {
      continue;
    }

    if (!response.ok) {
      throw toProviderError(response);
    }

    const payload = await parseJsonResponse(response);
    const wrapped = wrappedReportResponseSchema.safeParse(payload);
    const parsed = wrapped.success
      ? reportResponseSchema.safeParse(wrapped.data.result)
      : reportResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new HypeAuditorError(
        "HYPEAUDITOR_INVALID_RESPONSE",
        502,
        "HypeAuditor returned an invalid report response",
      );
    }

    assertReportReady(parsed.data);

    return parsed.data;
  }

  throw new HypeAuditorError(
    "HYPEAUDITOR_REQUEST_FAILED",
    502,
    "HypeAuditor request failed",
  );
}

async function fetchBrandMentions(input: {
  youtubeChannelId: string;
  baseUrl: string;
  authId: string;
  authToken: string;
  fetchFn: FetchLike;
}): Promise<unknown> {
  const requests = [
    {
      url: `${input.baseUrl.replace(/\/$/, "")}/api/method/auditor.youtubeBrandMentions/`,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-auth-id": input.authId,
          "x-auth-token": input.authToken,
        },
        body: new URLSearchParams({
          channel: input.youtubeChannelId,
          page: "1",
        }),
      } satisfies RequestInit,
    },
    {
      url: `${input.baseUrl.replace(/\/$/, "")}/api/v1/brands/brand_mentions?channel_id=${encodeURIComponent(input.youtubeChannelId)}&page=1`,
      init: {
        method: "GET",
        headers: {
          "x-auth-id": input.authId,
          "x-auth-token": input.authToken,
        },
      } satisfies RequestInit,
    },
  ] as const;

  for (const request of requests) {
    const response = await input.fetchFn(request.url, request.init);

    if (response.status === 404 && request !== requests.at(-1)) {
      continue;
    }

    if (!response.ok) {
      throw toProviderError(response);
    }

    return parseJsonResponse(response);
  }

  throw new HypeAuditorError(
    "HYPEAUDITOR_REQUEST_FAILED",
    502,
    "HypeAuditor request failed",
  );
}

export async function fetchHypeAuditorChannelInsights(
  rawInput: FetchHypeAuditorChannelInsightsInput,
): Promise<FetchHypeAuditorChannelInsightsResult> {
  const input = hypeAuditorInputSchema.parse(rawInput);
  const apiKey = getApiKey(input.apiKey);
  const { authId, authToken } = getCredentials(apiKey);
  const fetchFn = getFetch(input.fetchFn);

  const reportResponse = await fetchReport({
    youtubeChannelId: input.youtubeChannelId,
    baseUrl: input.baseUrl,
    authId,
    authToken,
    fetchFn,
  });
  const brandMentionsResponse = await fetchBrandMentions({
    youtubeChannelId: input.youtubeChannelId,
    baseUrl: input.baseUrl,
    authId,
    authToken,
    fetchFn,
  });

  return {
    insights: {
      audienceCountries: normalizeAudienceCountries(reportResponse.report),
      audienceGenderAge: normalizeAudienceGenderAge(reportResponse.report),
      audienceInterests: normalizeAudienceInterests(reportResponse.report),
      estimatedPrice: normalizeEstimatedPrice(reportResponse.report),
      brandMentions: normalizeBrandMentions(brandMentionsResponse),
    },
    rawPayload: {
      report: toJsonRecord(reportResponse),
      brandMentions: JSON.parse(JSON.stringify(brandMentionsResponse)) as unknown,
    },
  };
}
