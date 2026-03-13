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
  it("normalizes report and brand mention payloads from the youtube endpoints", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            report_state: "READY",
            report: {
              video_integration_price: {
                data: {
                  currency_code: "usd",
                  min: 500,
                  max: 900,
                },
              },
              features: {
                audience_geo: {
                  data: [
                    { title: "us", prc: 32.5 },
                    { title: "hr", prc: "18.4" },
                    { title: "uk", prc: 9.2 },
                  ],
                },
                audience_age_gender: {
                  data: {
                    "18-24": {
                      male: 11.2,
                      female: 21.5,
                    },
                    "25-34": {
                      male: 18.1,
                    },
                  },
                },
                audience_interests: {
                  data: [
                    { label: "Gaming", score: 0.88 },
                    { title: "Tech", score: "0.63" },
                  ],
                },
              },
            },
          }
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          result: [
            { basic: { title: "Nike" } },
            { title: "Apple" },
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
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://hypeauditor.com/api/method/auditor.youtube/");
    expect(fetchFn.mock.calls[1]?.[0]).toBe(
      "https://hypeauditor.com/api/method/auditor.youtubeBrandMentions/",
    );
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
    expect(result.rawPayload.report.report_state).toBe("READY");
  });

  it("falls back to the legacy endpoints when the youtube-specific endpoints are unavailable", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          report_state: "finished",
          report: {
            audience_geo: {
              us: 32.5,
            },
          },
        }),
      )
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ title: "Nike" }],
        }),
      );

    const result = await fetchHypeAuditorChannelInsights({
      youtubeChannelId: "UC-HYPE-1",
      apiKey: "auth-id:auth-token",
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(fetchFn.mock.calls[1]?.[0]).toBe("https://hypeauditor.com/api/method/auditor.report/");
    expect(fetchFn.mock.calls[3]?.[0]).toBe(
      "https://hypeauditor.com/api/v1/brands/brand_mentions?channel_id=UC-HYPE-1&page=1",
    );
    expect(result.insights.brandMentions).toEqual([{ brandName: "Nike" }]);
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
        result: {
          report_state: "NOT_READY",
          report: {},
        },
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
