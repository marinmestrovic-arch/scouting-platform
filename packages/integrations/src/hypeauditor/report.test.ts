import { describe, expect, it, vi } from "vitest";

import {
  HypeAuditorError,
  fetchHypeAuditorChannelInsights,
} from "./report";

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

describe("fetchHypeAuditorChannelInsights", () => {
  it("normalizes report and brand mention payloads", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          report_state: "finished",
          report: {
            audience_geo: {
              us: 32.5,
              hr: "18.4",
              uk: 9.2,
            },
            audience_age_male: {
              "18-24": 11.2,
              "25-34": 18.1,
            },
            audience_age_female: {
              "18-24": 21.5,
            },
            video_integration_price: {
              data: {
                currency_code: "usd",
                min: 500,
                max: 900,
              },
            },
            features: {
              audience_interests: {
                data: [
                  { label: "Gaming", score: 0.88 },
                  { title: "Tech", score: "0.63" },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            { title: "Nike" },
            { brand_name: "Apple" },
            { brand: { title: "Nike" } },
          ],
        }),
      );

    const result = await fetchHypeAuditorChannelInsights({
      youtubeChannelId: "UC-HYPE-1",
      apiKey: "auth-id:auth-token",
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.insights.audienceCountries).toEqual([
      {
        countryCode: "US",
        countryName: "United States",
        percentage: 32.5,
      },
      {
        countryCode: "HR",
        countryName: "Croatia",
        percentage: 18.4,
      },
      {
        countryCode: "GB",
        countryName: "United Kingdom",
        percentage: 9.2,
      },
    ]);
    expect(result.insights.audienceGenderAge[0]).toEqual({
      gender: "female",
      ageRange: "18-24",
      percentage: 21.5,
    });
    expect(result.insights.audienceInterests).toEqual([
      {
        label: "Gaming",
        score: 0.88,
      },
      {
        label: "Tech",
        score: 0.63,
      },
    ]);
    expect(result.insights.estimatedPrice).toEqual({
      currencyCode: "USD",
      min: 500,
      max: 900,
    });
    expect(result.insights.brandMentions).toEqual([
      { brandName: "Nike" },
      { brandName: "Apple" },
    ]);
    expect(result.rawPayload.report.report_state).toBe("finished");
  });

  it("requires a colon-delimited HYPEAUDITOR_API_KEY", async () => {
    await expect(
      fetchHypeAuditorChannelInsights({
        youtubeChannelId: "UC-HYPE-1",
        apiKey: "single-token",
        fetchFn: vi.fn(),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "HYPEAUDITOR_API_KEY_INVALID_FORMAT",
        status: 500,
      } satisfies Partial<HypeAuditorError>),
    );
  });

  it("maps auth failures", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("forbidden", {
        status: 403,
      }),
    );

    await expect(
      fetchHypeAuditorChannelInsights({
        youtubeChannelId: "UC-HYPE-1",
        apiKey: "auth-id:auth-token",
        fetchFn,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "HYPEAUDITOR_AUTH_FAILED",
        status: 401,
        message: "HypeAuditor credentials are invalid or unauthorized",
      } satisfies Partial<HypeAuditorError>),
    );
  });

  it("maps rate limit failures", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("rate limited", {
        status: 429,
      }),
    );

    await expect(
      fetchHypeAuditorChannelInsights({
        youtubeChannelId: "UC-HYPE-1",
        apiKey: "auth-id:auth-token",
        fetchFn,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "HYPEAUDITOR_RATE_LIMITED",
        status: 429,
      } satisfies Partial<HypeAuditorError>),
    );
  });

  it("fails when the report is not ready yet", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        report_state: "processing",
        report: {},
      }),
    );

    await expect(
      fetchHypeAuditorChannelInsights({
        youtubeChannelId: "UC-HYPE-1",
        apiKey: "auth-id:auth-token",
        fetchFn,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "HYPEAUDITOR_REPORT_NOT_READY",
        status: 503,
      } satisfies Partial<HypeAuditorError>),
    );
  });
});
