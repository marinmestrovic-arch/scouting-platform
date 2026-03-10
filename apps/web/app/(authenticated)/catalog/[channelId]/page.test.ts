import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { channelDetailShellMock } = vi.hoisted(() => ({
  channelDetailShellMock: vi.fn(({ channelId }: { channelId: string }) => `channel-detail-shell:${channelId}`),
}));

vi.mock("../../../../auth", () => {
  throw new Error("Catalog channel detail page should rely on the authenticated layout guard.");
});

vi.mock("../../../../components/catalog/channel-detail-shell", () => ({
  ChannelDetailShell: channelDetailShellMock,
}));

vi.mock("next/navigation", () => {
  throw new Error("Catalog channel detail page should rely on the authenticated layout guard.");
});

import CatalogChannelDetailPage from "./page";

describe("catalog channel detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the channel detail shell from route params without fetching detail data in the page", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const html = renderToStaticMarkup(
      await CatalogChannelDetailPage({
        params: Promise.resolve({ channelId: "channel-123" }),
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(channelDetailShellMock).toHaveBeenCalledTimes(1);
    expect(channelDetailShellMock.mock.calls[0]?.[0]).toEqual({ channelId: "channel-123" });
    expect(html).toContain("<h1>Channel Detail</h1>");
    expect(html).toContain(
      "Review the resolved catalog profile, enrichment state, and advanced report context for a single channel.",
    );
    expect(html).toContain("channel-detail-shell:channel-123");
  });

  it("removes the old Week 1 placeholder copy from the page description", async () => {
    const html = renderToStaticMarkup(
      await CatalogChannelDetailPage({
        params: Promise.resolve({ channelId: "channel-123" }),
      }),
    );

    expect(html).not.toContain("Week 1 shell only.");
    expect(html).not.toContain("Live channel data lands in Week 2.");
  });
});
