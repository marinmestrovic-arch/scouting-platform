import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const react = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      href,
      className,
      children,
    }: {
      href: string;
      className?: string;
      children: ReactNode;
    }) => react.createElement("a", { href, className }, children),
  };
});

import { ChannelDetailShell } from "./channel-detail-shell";

describe("channel detail shell", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders back navigation and route-specific context without fetching detail data", () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const html = renderToStaticMarkup(createElement(ChannelDetailShell, { channelId: "channel-123" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(html).toContain('href="/catalog"');
    expect(html).toContain("Back to catalog");
    expect(html).toContain("<dt>Catalog record ID</dt>");
    expect(html).not.toContain("<dt>Channel ID</dt>");
    expect(html).toContain("<code>channel-123</code>");
    expect(html).toContain("Week 1 detail scaffold");
    expect(html).toContain(
      "This Week 1 shell is intentionally static. Live channel data lands in Week 2. Enrichment and editing workflows stay deferred to later milestones.",
    );
  });

  it("renders accessible placeholder sections and stable shell labels", () => {
    const html = renderToStaticMarkup(createElement(ChannelDetailShell, { channelId: "channel-123" }));

    expect(html.match(/<section aria-labelledby=/g)).toHaveLength(4);
    expect(html).toContain('aria-labelledby="channel-detail-shell-overview-heading"');
    expect(html).toContain('id="channel-detail-shell-overview-heading"');
    expect(html).toContain('id="channel-detail-shell-identity-heading"');
    expect(html).toContain('id="channel-detail-shell-catalog-metadata-heading"');
    expect(html).toContain('id="channel-detail-shell-enrichment-heading"');
    expect(html).toContain("Identity");
    expect(html).toContain("Catalog metadata");
    expect(html).toContain("Enrichment and workflow");
    expect(html).toContain("Channel title");
    expect(html).toContain("Catalog status");
    expect(html).toContain("Requests and follow-up actions");
    expect(html).toContain("Enrichment actions arrive in later milestones.");
    expect(html).toContain("Manual override context and controls stay deferred to later milestones.");
  });
});
