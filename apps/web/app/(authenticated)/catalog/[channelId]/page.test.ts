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

  it("renders the week 1 shell from route params without fetching detail data", async () => {
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
      "Week 1 shell only. Live channel data lands in Week 2. Enrichment and editing workflows stay deferred to later milestones.",
    );
    expect(html).toContain("channel-detail-shell:channel-123");
  });

  it("removes the old placeholder copy and avoids promising Week 2 workflows", async () => {
    const html = renderToStaticMarkup(
      await CatalogChannelDetailPage({
        params: Promise.resolve({ channelId: "channel-123" }),
      }),
    );

    expect(html).not.toContain("Channel detail shell lands in Week 1.");
    expect(html).not.toContain("Live channel data, enrichment actions, and manual editing arrive in Week 2.");
  });
});
