import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchYoutubeDeclaredCountries,
  fetchYoutubeDeclaredCountry,
  type YoutubeChannelCountryProviderError,
} from "./country";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchYoutubeDeclaredCountry", () => {
  it("fetches up to 50 channel countries in one request and maps by channel id", async () => {
    const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>(
      async () => new Response(JSON.stringify({
        items: [
          { id: "UC-2", snippet: {} },
          { id: "UC-1", snippet: { country: "hr" } },
        ],
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchYoutubeDeclaredCountries({
      apiKey: "youtube-key",
      channelIds: ["UC-1", "UC-2"],
    });

    expect([...result.entries()]).toEqual([
      ["UC-2", null],
      ["UC-1", "HR"],
    ]);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get("id")).toBe("UC-1,UC-2");
    expect(requestedUrl.searchParams.get("maxResults")).toBe("2");
  });

  it("returns the normalized channel-declared country from a snippet request", async () => {
    const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>(
      async () => new Response(JSON.stringify({
        items: [{ id: "UC-1", snippet: { country: "hr" } }],
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchYoutubeDeclaredCountry({
      apiKey: "youtube-key",
      channelId: "UC-1",
    })).resolves.toEqual({ countryCode: "HR" });

    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get("part")).toBe("snippet");
    expect(requestedUrl.searchParams.get("fields")).toBe("items(id,snippet(country))");
  });

  it("returns null when the channel has no declared country", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [{ id: "UC-1", snippet: {} }],
    }), { status: 200 })));

    await expect(fetchYoutubeDeclaredCountry({
      apiKey: "youtube-key",
      channelId: "UC-1",
    })).resolves.toEqual({ countryCode: null });
  });

  it("normalizes authentication failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { errors: [{ reason: "keyInvalid" }] },
    }), { status: 403 })));

    await expect(fetchYoutubeDeclaredCountry({
      apiKey: "bad-key",
      channelId: "UC-1",
    })).rejects.toMatchObject({
      code: "YOUTUBE_AUTH_FAILED",
      status: 401,
    } satisfies Partial<YoutubeChannelCountryProviderError>);
  });

  it("retries one transient provider failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "UC-1", snippet: { country: "cz" } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchYoutubeDeclaredCountry({
      apiKey: "youtube-key",
      channelId: "UC-1",
    })).resolves.toEqual({ countryCode: "CZ" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
