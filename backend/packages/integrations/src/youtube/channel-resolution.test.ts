import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveYoutubeChannelForEnrichment } from "./channel-resolution";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("resolveYoutubeChannelForEnrichment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves direct channel-id urls without external requests", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveYoutubeChannelForEnrichment({
      input: "https://www.youtube.com/channel/UCoVGcDm7a76Lvf26AB-olOA",
    });

    expect(resolved).toEqual({
      channelId: "UCoVGcDm7a76Lvf26AB-olOA",
      canonicalUrl: "https://www.youtube.com/channel/UCoVGcDm7a76Lvf26AB-olOA",
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("resolves @handle urls via YouTube channels forHandle lookups", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "UCoVGcDm7a76Lvf26AB-olOA",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveYoutubeChannelForEnrichment({
      input: "https://www.youtube.com/@FrankSlotta",
      apiKey: "yt-key",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("forHandle=FrankSlotta");
    expect(resolved).toEqual({
      channelId: "UCoVGcDm7a76Lvf26AB-olOA",
      canonicalUrl: "https://www.youtube.com/@FrankSlotta",
    });
  });

  it("falls back to oembed when no api key exists for @handle urls", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        author_url: "https://www.youtube.com/channel/UCoVGcDm7a76Lvf26AB-olOA",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveYoutubeChannelForEnrichment({
      input: "https://www.youtube.com/@FrankSlotta",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("youtube.com/oembed");
    expect(resolved).toEqual({
      channelId: "UCoVGcDm7a76Lvf26AB-olOA",
      canonicalUrl: "https://www.youtube.com/@FrankSlotta",
    });
  });

  it("returns null for non-youtube input", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveYoutubeChannelForEnrichment({
      input: "https://example.com/channel",
      channelName: "Creator",
    });

    expect(resolved).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
