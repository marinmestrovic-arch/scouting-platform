import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
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
  }) => createElement("img", { alt, className, height, src, width }),
}));

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

import { ChannelDetailShellView } from "./channel-detail-shell";

const baseChannelDetail = {
  id: "53adac17-f39d-4731-a61f-194150fbc431",
  youtubeChannelId: "UC123",
  title: "Orbital Deep Dive",
  handle: "@orbitaldeepdive",
  description: "Weekly coverage of launch systems and creator strategy.",
  thumbnailUrl: "https://example.com/thumb.jpg",
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-08T10:00:00.000Z",
  enrichment: {
    status: "completed" as const,
    updatedAt: "2026-03-08T10:00:00.000Z",
    completedAt: "2026-03-08T10:00:00.000Z",
    lastError: null,
    summary: "Creator focused on launches and industry analysis.",
    topics: ["space", "launches"],
    brandFitNotes: "Strong fit for launch providers.",
    confidence: 0.82,
  },
  advancedReport: {
    requestId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
    status: "completed" as const,
    updatedAt: "2026-03-08T10:00:00.000Z",
    completedAt: "2026-03-08T10:00:00.000Z",
    lastError: null,
    requestedAt: "2026-03-07T08:00:00.000Z",
    reviewedAt: "2026-03-07T09:00:00.000Z",
    decisionNote: "Approved.",
    lastCompletedReport: {
      requestId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
      completedAt: "2026-03-08T10:00:00.000Z",
      ageDays: 12,
      withinFreshWindow: true,
    },
  },
  insights: {
    audienceCountries: [
      {
        countryCode: "US",
        countryName: "United States",
        percentage: 32.5,
      },
    ],
    audienceGenderAge: [
      {
        gender: "female",
        ageRange: "18-24",
        percentage: 21.4,
      },
    ],
    audienceInterests: [
      {
        label: "Space tech",
        score: 0.88,
      },
    ],
    estimatedPrice: {
      currencyCode: "USD",
      min: 500,
      max: 900,
    },
    brandMentions: [
      {
        brandName: "SpaceX",
      },
    ],
  },
};

describe("channel detail shell view", () => {
  it("renders the live channel detail layout for a resolved channel", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelDetailShellView, {
        channelId: baseChannelDetail.id,
        onRetry: vi.fn(),
        requestState: {
          status: "ready",
          data: baseChannelDetail,
          error: null,
        },
      }),
    );

    expect(html).toContain('href="/catalog"');
    expect(html).toContain("Back to catalog");
    expect(html).toContain("Orbital Deep Dive");
    expect(html).toContain("@orbitaldeepdive");
    expect(html).toContain("Enrichment: Ready");
    expect(html).toContain("Advanced report: Completed");
    expect(html).toContain("Weekly coverage of launch systems and creator strategy.");
    expect(html).toContain("Creator focused on launches and industry analysis.");
    expect(html).toContain("Last completed report is fresh (12 days old).");
    expect(html).toContain("United States");
    expect(html).toContain("SpaceX");
    expect(html).toContain("USD 500-900");
  });

  it("renders the admin manual edit panel when manual edit controls are enabled", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelDetailShellView, {
        channelId: baseChannelDetail.id,
        canManageManualEdits: true,
        onChannelUpdated: vi.fn(),
        onRetry: vi.fn(),
        requestState: {
          status: "ready",
          data: baseChannelDetail,
          error: null,
        },
      }),
    );

    expect(html).toContain("Admin manual edits");
    expect(html).toContain("Save override");
    expect(html).toContain("Restore fallback");
  });

  it("renders retryable error feedback when the request fails", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelDetailShellView, {
        channelId: baseChannelDetail.id,
        onRetry: vi.fn(),
        requestState: {
          status: "error",
          data: null,
          error: "Catalog temporarily unavailable.",
        },
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Catalog temporarily unavailable.");
    expect(html).toContain(">Retry<");
  });

  it("renders an explicit not-found state for missing catalog records", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelDetailShellView, {
        channelId: "missing-channel-id",
        onRetry: vi.fn(),
        requestState: {
          status: "notFound",
          data: null,
          error: null,
        },
      }),
    );

    expect(html).toContain("Channel not found");
    expect(html).toContain("We could not find a catalog record for");
    expect(html).toContain("<code>missing-channel-id</code>");
  });
});
