import type { ChannelEnrichmentStatus, ListChannelsResponse } from "@scouting-platform/contracts";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("next/image", async () => {
  const react = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      alt,
      className,
      height,
      src,
      width,
    }: {
      alt: string;
      className?: string;
      height: number;
      src: string;
      width: number;
    }) => react.createElement("img", { alt, className, height, src, width }),
  };
});

import {
  CatalogTableShellView,
  formatChannelCountSummary,
  getEmptyCatalogMessage,
  getNextCatalogPage,
  getPreviousCatalogPage,
  hasNextCatalogPage,
  hasPreviousCatalogPage,
} from "./catalog-table-shell";

function createAdvancedReportSummary() {
  return {
    requestId: null,
    status: "missing" as const,
    updatedAt: null,
    completedAt: null,
    lastError: null,
  };
}

const pagedChannels: ListChannelsResponse = {
  items: [
    {
      id: "50cb8343-229e-4f4c-9d8d-c17297f91288",
      youtubeChannelId: "UC_CHANNEL_ONE",
      title: "Channel One",
      handle: "@channelone",
      thumbnailUrl: "https://example.com/channel-one.jpg",
      enrichment: {
        status: "completed",
        updatedAt: "2026-03-08T10:00:00.000Z",
        completedAt: "2026-03-08T10:00:00.000Z",
        lastError: null,
      },
      advancedReport: createAdvancedReportSummary(),
    },
    {
      id: "e11e5184-79a2-42bf-bceb-345f30611c39",
      youtubeChannelId: "UC_CHANNEL_TWO",
      title: "Channel Two",
      handle: null,
      thumbnailUrl: null,
      enrichment: {
        status: "queued",
        updatedAt: null,
        completedAt: null,
        lastError: null,
      },
      advancedReport: createAdvancedReportSummary(),
    },
  ],
  total: 42,
  page: 2,
  pageSize: 20,
};

function buildChannelResponse(
  page: number,
  total: number,
  pageSize: number,
  label: string,
): ListChannelsResponse {
  return {
    items: [
      {
        id: `00000000-0000-0000-0000-${page.toString().padStart(12, "0")}`,
        youtubeChannelId: `UC_PAGE_${page}`,
        title: label,
        handle: `@page${page}`,
        thumbnailUrl: null,
        enrichment: {
          status: "missing",
          updatedAt: null,
          completedAt: null,
          lastError: null,
        },
        advancedReport: createAdvancedReportSummary(),
      },
    ],
    total,
    page,
    pageSize,
  };
}

function renderView(requestState: Parameters<typeof CatalogTableShellView>[0]["requestState"]): string {
  return renderToStaticMarkup(
    createElement(CatalogTableShellView, {
      requestState,
      onRetry: vi.fn(),
      onPreviousPage: vi.fn(),
      onNextPage: vi.fn(),
    }),
  );
}

describe("catalog table shell view", () => {
  it("formats the channel count summary", () => {
    expect(formatChannelCountSummary(pagedChannels)).toBe("Showing 21-22 of 42 channels");
  });

  it("formats out-of-range empty pages without a broken range", () => {
    expect(
      formatChannelCountSummary({
        items: [],
        total: 5,
        page: 2,
        pageSize: 20,
      }),
    ).toBe("Showing 0 of 5 channels");
    expect(
      getEmptyCatalogMessage({
        total: 5,
      }),
    ).toBe("No channels found on this page.");
  });

  it("derives previous and next paging behavior", () => {
    const firstPage = buildChannelResponse(1, 21, 20, "Page One Channel");
    const finalPage = buildChannelResponse(2, 21, 20, "Page Two Channel");

    expect(hasPreviousCatalogPage(firstPage)).toBe(false);
    expect(getPreviousCatalogPage(firstPage)).toBeNull();
    expect(hasNextCatalogPage(firstPage)).toBe(true);
    expect(getNextCatalogPage(firstPage)).toBe(2);

    expect(hasPreviousCatalogPage(finalPage)).toBe(true);
    expect(getPreviousCatalogPage(finalPage)).toBe(1);
    expect(hasNextCatalogPage(finalPage)).toBe(false);
    expect(getNextCatalogPage(finalPage)).toBeNull();
  });

  it("renders loading state", () => {
    const html = renderView({
      status: "loading",
      data: null,
      error: null,
    });

    expect(html).toContain("Loading channels...");
  });

  it("renders actionable error feedback", () => {
    const html = renderView({
      status: "error",
      data: null,
      error: "Unable to load channels. Please try again.",
    });

    expect(html).toContain("Unable to load channels. Please try again.");
    expect(html).toContain("Retry");
    expect(html).toContain("role=\"alert\"");
  });

  it("renders empty state with both paging buttons disabled", () => {
    const html = renderView({
      status: "ready",
      data: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      },
      error: null,
    });

    expect(html).toContain("0 channels");
    expect(html).toContain("No channels found yet.");
    expect(html).toContain("Page 1");
    expect(html).toContain(">Previous</button>");
    expect(html).toContain(">Next</button>");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("renders populated rows, detail links, and all enrichment labels", () => {
    const statuses: Array<[ChannelEnrichmentStatus, string]> = [
      ["completed", "Ready"],
      ["failed", "Failed"],
      ["missing", "Missing"],
      ["queued", "Queued"],
      ["running", "Running"],
      ["stale", "Stale"],
    ];

    const html = renderView({
      status: "ready",
      data: {
        items: statuses.map(([status], index) => ({
          id: `00000000-0000-0000-0000-${(index + 1).toString().padStart(12, "0")}`,
          youtubeChannelId: `UC_STATUS_${index + 1}`,
          title: `Channel ${index + 1}`,
          handle: index === 0 ? "@channelone" : null,
          thumbnailUrl: index === 0 ? "https://example.com/thumb.jpg" : null,
          enrichment: {
            status,
            updatedAt: null,
            completedAt: null,
            lastError: status === "failed" ? "Provider error" : null,
          },
          advancedReport: createAdvancedReportSummary(),
        })),
        total: statuses.length,
        page: 1,
        pageSize: 20,
      },
      error: null,
    });

    expect(html).toContain("Channel 1");
    expect(html).toContain("@channelone");
    expect(html).toContain("No handle");
    expect(html).toContain("UC_STATUS_1");
    expect(html).toContain("href=\"/catalog/00000000-0000-0000-0000-000000000001\"");
    expect(html).toContain("Open channel");

    for (const [, label] of statuses) {
      expect(html).toContain(label);
    }
  });

  it("renders previous enabled and next disabled on the final page", () => {
    const html = renderView({
      status: "ready",
      data: {
        items: pagedChannels.items,
        total: 22,
        page: 2,
        pageSize: 20,
      },
      error: null,
    });

    expect(html).toContain("Showing 21-22 of 22 channels");
    expect(html).toContain("Page 2");
    expect(html).toContain(">Previous</button>");
    expect(html).toContain(">Next</button>");
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });
});
