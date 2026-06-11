import type {
  ChannelEnrichmentStatus,
  CsvExportBatchDetail,
  CsvExportBatchSummary,
  ListChannelsResponse,
} from "@scouting-platform/contracts";
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
  areCatalogFiltersEqual,
  areAllCatalogPageRowsSelected,
  buildSavedSegmentFilters,
  buildCatalogHref,
  buildCatalogSearchParams,
  CatalogTableShellView,
  countSelectedCatalogPageRows,
  formatCatalogSelectionSummary,
  formatSavedSegmentSummary,
  formatChannelCountSummary,
  getCatalogFiltersFromSavedSegment,
  getCatalogEnrichmentDetailCopy,
  getEmptyCatalogMessage,
  getNextCatalogPage,
  getPreviousCatalogPage,
  hasNextCatalogPage,
  hasPreviousCatalogPage,
  mergeCatalogBatchEnrichmentResults,
  parseCatalogUrlState,
  shouldPollCatalogCsvExportBatch,
  shouldPollCatalogEnrichmentRows,
  summarizeCatalogBatchEnrichmentResults,
  toggleCatalogChannelSelection,
  toggleCatalogMultiValueFilter,
  toggleCatalogPageSelection,
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
      youtubeUrl: "https://youtube.com/@channelone",
      youtubeEngagementRate: 3.2,
      youtubeVideoMedianViews: "220000",
      youtubeShortsMedianViews: "180000",
      youtubeFollowers: "500000",
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
        youtubeUrl: null,
        youtubeEngagementRate: null,
        youtubeVideoMedianViews: null,
        youtubeShortsMedianViews: null,
        youtubeFollowers: null,
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
        youtubeUrl: `https://youtube.com/@page${page}`,
        youtubeEngagementRate: 2.4,
        youtubeVideoMedianViews: "120000",
        youtubeShortsMedianViews: "95000",
        youtubeFollowers: "150000",
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

function renderView(
  requestState: Parameters<typeof CatalogTableShellView>[0]["requestState"],
  options?: {
    selectedChannelIds?: string[];
    batchEnrichmentActionState?: Parameters<
      typeof CatalogTableShellView
    >[0]["batchEnrichmentActionState"];
    latestCsvExportBatch?: Parameters<typeof CatalogTableShellView>[0]["latestCsvExportBatch"];
    deleteActionState?: Parameters<typeof CatalogTableShellView>[0]["deleteActionState"];
    isAdmin?: boolean;
  },
): string {
  return renderToStaticMarkup(
    createElement(CatalogTableShellView, {
      creatorFilterOptions: {
        countryRegion: [{ value: "Croatia", label: "Croatia" }],
        influencerVertical: [{ value: "Gaming", label: "Gaming" }],
        influencerType: [{ value: "Creator", label: "Creator" }],
      },
      filters: {
        query: "space",
        countryRegion: ["Croatia"],
        influencerVertical: ["Gaming"],
        influencerType: ["Creator"],
        youtubeVideoMedianViewsMin: "100000",
        youtubeVideoMedianViewsMax: "",
        youtubeShortsMedianViewsMin: "",
        youtubeShortsMedianViewsMax: "",
        youtubeFollowersMin: "",
        youtubeFollowersMax: "",
        enrichmentStatus: "",
      },
      selectedChannelIds: options?.selectedChannelIds ?? [],
      batchEnrichmentActionState: options?.batchEnrichmentActionState ?? {
        type: "idle",
        message: "",
      },
      deleteActionState: options?.deleteActionState ?? {
        type: "idle",
        message: "",
      },
      latestCsvExportBatch: options?.latestCsvExportBatch ?? {
        requestState: "idle",
        summary: null,
        detail: null,
        error: null,
        isRefreshing: false,
      },
      isAdmin: options?.isAdmin ?? false,
      requestState,
      onClearSelection: vi.fn(),
      onDeleteSelectedChannels: vi.fn(),
      onQueryChange: vi.fn(),
      onExportSelectedChannels: vi.fn(),
      onNextPage: vi.fn(),
      onPreviousPage: vi.fn(),
      onRequestFilteredEnrichment: vi.fn(),
      onRequestSelectedEnrichment: vi.fn(),
      onResetFilters: vi.fn(),
      onRetry: vi.fn(),
      onToggleChannelSelection: vi.fn(),
      onNumericFilterChange: vi.fn(),
      onClearNumericRangeFilter: vi.fn(),
      onClearMultiValueFilter: vi.fn(),
      onEnrichmentStatusChange: vi.fn(),
      onToggleMultiValueFilter: vi.fn(),
      onTogglePageSelection: vi.fn(),
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

  it("parses, serializes, and compares URL-backed filter state", () => {
    const searchParams = new URLSearchParams(
      "page=3&query=space&countryRegion=Croatia&countryRegion=Germany&influencerVertical=Gaming&youtubeVideoMedianViewsMin=100000&youtubeFollowersMax=500000&enrichmentStatus=failed&advancedReportStatus=stale",
    );

    const parsed = parseCatalogUrlState(searchParams);

    expect(parsed).toEqual({
      page: 3,
      filters: {
        query: "space",
        countryRegion: ["Croatia", "Germany"],
        influencerVertical: ["Gaming"],
        influencerType: [],
        youtubeVideoMedianViewsMin: "100000",
        youtubeVideoMedianViewsMax: "",
        youtubeShortsMedianViewsMin: "",
        youtubeShortsMedianViewsMax: "",
        youtubeFollowersMin: "",
        youtubeFollowersMax: "500000",
        enrichmentStatus: "failed",
      },
    });

    expect(buildCatalogSearchParams(parsed).toString()).toBe(
      "page=3&query=space&countryRegion=Croatia&countryRegion=Germany&influencerVertical=Gaming&youtubeVideoMedianViewsMin=100000&youtubeFollowersMax=500000&enrichmentStatus=failed",
    );
    expect(buildCatalogHref("/catalog", parsed)).toBe(
      "/catalog?page=3&query=space&countryRegion=Croatia&countryRegion=Germany&influencerVertical=Gaming&youtubeVideoMedianViewsMin=100000&youtubeFollowersMax=500000&enrichmentStatus=failed",
    );
    expect(
      areCatalogFiltersEqual(parsed.filters, {
        query: "space",
        countryRegion: ["Croatia", "Germany"],
        influencerVertical: ["Gaming"],
        influencerType: [],
        youtubeVideoMedianViewsMin: "100000",
        youtubeVideoMedianViewsMax: "",
        youtubeShortsMedianViewsMin: "",
        youtubeShortsMedianViewsMax: "",
        youtubeFollowersMin: "",
        youtubeFollowersMax: "500000",
        enrichmentStatus: "failed",
      }),
    ).toBe(true);
  });

  it("toggles multi-value filters while preserving current selections", () => {
    const afterAdd = toggleCatalogMultiValueFilter(["Croatia"], "Germany");
    expect(afterAdd).toEqual(["Croatia", "Germany"]);

    const afterRemove = toggleCatalogMultiValueFilter(afterAdd, "Croatia");
    expect(afterRemove).toEqual(["Germany"]);
  });

  it("tracks row selection across individual rows and the current page", () => {
    const pageItems = pagedChannels.items;

    expect(toggleCatalogChannelSelection([], pageItems[0]!.id)).toEqual([pageItems[0]!.id]);
    expect(toggleCatalogChannelSelection([pageItems[0]!.id], pageItems[0]!.id)).toEqual([]);
    expect(
      toggleCatalogPageSelection(["sticky-selection"], pageItems).sort((left, right) =>
        left.localeCompare(right),
      ),
    ).toEqual(["sticky-selection", pageItems[0]!.id, pageItems[1]!.id].sort((left, right) => left.localeCompare(right)));
    expect(
      toggleCatalogPageSelection(
        ["sticky-selection", pageItems[0]!.id, pageItems[1]!.id],
        pageItems,
      ),
    ).toEqual(["sticky-selection"]);
    expect(countSelectedCatalogPageRows([pageItems[0]!.id, "other"], pageItems)).toBe(1);
    expect(areAllCatalogPageRowsSelected([pageItems[0]!.id, pageItems[1]!.id], pageItems)).toBe(true);
  });

  it("formats selection summary copy", () => {
    expect(formatCatalogSelectionSummary(0, 0)).toBe("No channels selected.");
    expect(formatCatalogSelectionSummary(2, 2)).toBe("2 channels selected");
    expect(formatCatalogSelectionSummary(3, 1)).toBe("3 channels selected · 1 on this page");
    expect(formatCatalogSelectionSummary(1, 0)).toBe("1 channel selected · none on this page");
  });

  it("summarizes batch enrich outcomes for mixed queue, running, and failure states", () => {
    expect(
      summarizeCatalogBatchEnrichmentResults([
        {
          channelId: "00000000-0000-0000-0000-000000000001",
          ok: true,
          enrichment: {
            status: "queued",
            updatedAt: null,
            completedAt: null,
            lastError: null,
            summary: null,
            topics: null,
            brandFitNotes: null,
            confidence: null,
            structuredProfile: null,
          },
        },
        {
          channelId: "00000000-0000-0000-0000-000000000002",
          ok: true,
          enrichment: {
            status: "running",
            updatedAt: "2026-03-08T10:00:00.000Z",
            completedAt: null,
            lastError: null,
            summary: null,
            topics: null,
            brandFitNotes: null,
            confidence: null,
            structuredProfile: null,
          },
        },
        {
          channelId: "00000000-0000-0000-0000-000000000003",
          ok: false,
          error: new Error("Assigned YouTube API key is required before requesting enrichment"),
        },
      ]),
    ).toEqual({
      type: "error",
      message:
        "Queued 1 channel for enrichment. 1 channel already running. 1 request failed: Assigned YouTube API key is required before requesting enrichment. The table refreshes automatically while jobs run.",
    });
  });

  it("merges successful batch enrich results into visible catalog rows only", () => {
    const merged = mergeCatalogBatchEnrichmentResults(pagedChannels, [
      {
        channelId: pagedChannels.items[0]!.id,
        ok: true,
        enrichment: {
          status: "queued",
          updatedAt: "2026-03-11T09:00:00.000Z",
          completedAt: null,
          lastError: null,
          summary: null,
          topics: null,
          brandFitNotes: null,
          confidence: null,
          structuredProfile: null,
        },
      },
      {
        channelId: "00000000-0000-0000-0000-000000009999",
        ok: true,
        enrichment: {
          status: "running",
          updatedAt: "2026-03-11T09:05:00.000Z",
          completedAt: null,
          lastError: null,
          summary: null,
          topics: null,
          brandFitNotes: null,
          confidence: null,
          structuredProfile: null,
        },
      },
    ]);

    expect(merged.items[0]?.enrichment).toEqual({
      status: "queued",
      updatedAt: "2026-03-11T09:00:00.000Z",
      completedAt: null,
      lastError: null,
    });
    expect(merged.items[1]?.enrichment).toEqual(pagedChannels.items[1]?.enrichment);
  });

  it("removes newly queued channels from a completed-only result set", () => {
    const merged = mergeCatalogBatchEnrichmentResults(
      pagedChannels,
      [
        {
          channelId: pagedChannels.items[0]!.id,
          ok: true,
          enrichment: {
            status: "queued",
            updatedAt: "2026-03-11T09:00:00.000Z",
            completedAt: null,
            lastError: null,
            summary: null,
            topics: null,
            brandFitNotes: null,
            confidence: null,
            structuredProfile: null,
          },
        },
      ],
      ["completed"],
    );

    expect(merged.items.map((channel) => channel.id)).toEqual([pagedChannels.items[1]!.id]);
    expect(merged.total).toBe(41);
  });

  it("formats per-row enrichment copy and polling eligibility", () => {
    expect(
      getCatalogEnrichmentDetailCopy({
        status: "completed",
        updatedAt: "2026-03-08T10:00:00.000Z",
        completedAt: "2026-03-09T11:15:00.000Z",
        lastError: null,
      }),
    ).toBe("Completed 2026-03-09 11:15 UTC.");
    expect(
      getCatalogEnrichmentDetailCopy({
        status: "completed",
        updatedAt: "2026-03-08T10:00:00.000Z",
        completedAt: null,
        lastError: null,
      }),
    ).toBe("Completed 2026-03-08 10:00 UTC.");
    expect(
      getCatalogEnrichmentDetailCopy({
        status: "stale",
        updatedAt: "2026-03-07T09:30:00.000Z",
        completedAt: null,
        lastError: null,
      }),
    ).toBe("Stale since 2026-03-07 09:30 UTC.");
    expect(
      getCatalogEnrichmentDetailCopy({
        status: "failed",
        updatedAt: null,
        completedAt: null,
        lastError: null,
      }),
    ).toBe("Last attempt failed before the worker completed.");

    expect(shouldPollCatalogEnrichmentRows(pagedChannels)).toBe(true);
    expect(
      shouldPollCatalogEnrichmentRows({
        items: [
          {
            ...pagedChannels.items[0]!,
            enrichment: {
              status: "completed",
              updatedAt: "2026-03-08T10:00:00.000Z",
              completedAt: "2026-03-08T10:00:00.000Z",
              lastError: null,
            },
          },
        ],
      }),
    ).toBe(false);

    expect(
      shouldPollCatalogCsvExportBatch({
        requestState: "ready",
        summary: buildBatchSummaryPayloadForCatalogTests({
          status: "running",
        }),
        detail: null,
        error: null,
        isRefreshing: false,
      }),
    ).toBe(true);
  });

  it("round-trips saved segment filters into catalog filter state", () => {
    const baseFilters: Parameters<typeof buildSavedSegmentFilters>[0] = {
      query: "  space  ",
      countryRegion: ["Croatia", "Germany"],
      influencerVertical: ["Gaming"],
      influencerType: [],
      youtubeVideoMedianViewsMin: "100000",
      youtubeVideoMedianViewsMax: "",
      youtubeShortsMedianViewsMin: "",
      youtubeShortsMedianViewsMax: "",
      youtubeFollowersMin: "",
      youtubeFollowersMax: "500000",
      enrichmentStatus: "",
    };
    const filters = buildSavedSegmentFilters(baseFilters);

    expect(filters).toEqual({
      query: "space",
      countryRegion: ["Croatia", "Germany"],
      influencerVertical: ["Gaming"],
      youtubeVideoMedianViewsMin: 100000,
      youtubeFollowersMax: 500000,
    });
    expect(getCatalogFiltersFromSavedSegment(filters)).toEqual({
      query: "space",
      countryRegion: ["Croatia", "Germany"],
      influencerVertical: ["Gaming"],
      influencerType: [],
      youtubeVideoMedianViewsMin: "100000",
      youtubeVideoMedianViewsMax: "",
      youtubeShortsMedianViewsMin: "",
      youtubeShortsMedianViewsMax: "",
      youtubeFollowersMin: "",
      youtubeFollowersMax: "500000",
      enrichmentStatus: "",
    });
    expect(getCatalogFiltersFromSavedSegment({
      enrichmentStatus: ["completed"],
      advancedReportStatus: ["stale"],
    })).toEqual({
      query: "",
      countryRegion: [],
      influencerVertical: [],
      influencerType: [],
      youtubeVideoMedianViewsMin: "",
      youtubeVideoMedianViewsMax: "",
      youtubeShortsMedianViewsMin: "",
      youtubeShortsMedianViewsMax: "",
      youtubeFollowersMin: "",
      youtubeFollowersMax: "",
      enrichmentStatus: "enriched",
    });
    expect(buildSavedSegmentFilters({ ...baseFilters, enrichmentStatus: "enriched" }).enrichmentStatus)
      .toEqual(["completed"]);
    expect(buildSavedSegmentFilters({ ...baseFilters, enrichmentStatus: "not_enriched" }).enrichmentStatus)
      .toEqual(["missing"]);
    expect(buildSavedSegmentFilters({ ...baseFilters, enrichmentStatus: "queued" }).enrichmentStatus)
      .toEqual(["queued"]);
    expect(buildSavedSegmentFilters({ ...baseFilters, enrichmentStatus: "running" }).enrichmentStatus)
      .toEqual(["running"]);
    expect(buildSavedSegmentFilters({ ...baseFilters, enrichmentStatus: "failed" }).enrichmentStatus)
      .toEqual(["failed"]);
    expect(buildSavedSegmentFilters({ ...baseFilters, enrichmentStatus: "stale" }).enrichmentStatus)
      .toEqual(["stale"]);
    expect(
      formatSavedSegmentSummary({
        locale: "en",
      }),
    ).toBe("All catalog channels");
  });

  it("renders loading state", () => {
    const html = renderView({
      status: "loading",
      data: null,
      error: null,
    });

    expect(html).toContain("Country/Region");
    expect(html).toContain("Video Median Views");
    expect(html).toContain("Clear all");
    expect(html).toContain("Loading channels...");
    expect(html).not.toContain(">Save</button>");
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
    expect(html).toContain("No channels match the current filters.");
    expect(html).toContain("Page 1");
    expect(html).toContain(">Previous</button>");
    expect(html).toContain(">Next</button>");
  });

  it("renders populated rows with the current catalog table columns", () => {
    const statuses: Array<{
      status: ChannelEnrichmentStatus;
      label: string;
      copy: string;
      updatedAt: string | null;
      completedAt: string | null;
      lastError: string | null;
    }> = [
      {
        status: "completed",
        label: "Ready",
        copy: "Completed 2026-03-08 10:00 UTC.",
        updatedAt: "2026-03-08T10:00:00.000Z",
        completedAt: null,
        lastError: null,
      },
      {
        status: "failed",
        label: "Failed",
        copy: "Last attempt failed: Provider error",
        updatedAt: null,
        completedAt: null,
        lastError: "Provider error",
      },
      {
        status: "missing",
        label: "Missing",
        copy: "No enrichment requested yet.",
        updatedAt: null,
        completedAt: null,
        lastError: null,
      },
      {
        status: "queued",
        label: "Queued",
        copy: "Queued and auto-refreshing.",
        updatedAt: null,
        completedAt: null,
        lastError: null,
      },
      {
        status: "running",
        label: "Running",
        copy: "Running and auto-refreshing.",
        updatedAt: null,
        completedAt: null,
        lastError: null,
      },
      {
        status: "stale",
        label: "Stale",
        copy: "Stale since 2026-03-07 09:30 UTC.",
        updatedAt: "2026-03-07T09:30:00.000Z",
        completedAt: null,
        lastError: null,
      },
    ];

    const html = renderView({
      status: "ready",
      data: {
        items: statuses.map(({ status, updatedAt, completedAt, lastError }, index) => ({
          id: `00000000-0000-0000-0000-${(index + 1).toString().padStart(12, "0")}`,
          youtubeChannelId: `UC_STATUS_${index + 1}`,
          title: `Channel ${index + 1}`,
          handle: index === 0 ? "@channelone" : null,
          youtubeUrl: index === 0 ? "https://youtube.com/@channelone" : null,
          youtubeEngagementRate: index === 0 ? 3.2 : null,
          youtubeVideoMedianViews: index === 0 ? "220000" : null,
          youtubeShortsMedianViews: index === 0 ? "180000" : null,
          youtubeFollowers: index === 0 ? "500000" : null,
          thumbnailUrl: index === 0 ? "https://example.com/thumb.jpg" : null,
          enrichment: {
            status,
            updatedAt,
            completedAt,
            lastError,
          },
          advancedReport: createAdvancedReportSummary(),
        })),
        total: statuses.length,
        page: 1,
        pageSize: 20,
      },
      error: null,
    });

    expect(html).toContain("value=\"space\"");
    expect(html).toContain("YouTube Video Median Views");
    expect(html).toContain("YouTube Shorts Median Views");
    expect(html).toContain("220,000");
    expect(html).toContain("180,000");
    expect(html).toContain("href=\"/catalog/00000000-0000-0000-0000-000000000001\"");
    expect(html).toContain("Platforms");
    expect(html).toContain("Country/Region");
    expect(html).toContain("Influencer Type");
    expect(html).toContain(">—<");
  });

  it("renders row selection controls and highlights selected rows", () => {
    const html = renderView(
      {
        status: "ready",
        data: pagedChannels,
        error: null,
      },
      {
        selectedChannelIds: [pagedChannels.items[0]!.id],
      },
    );

    expect(html).toContain("Select all channels on this page");
    expect(html).toContain("Select Channel One");
    expect(html).toContain("1 channel selected");
    expect(html).toContain("Clear selection");
    expect(html).toContain("catalog-table__row catalog-table__row--selected");
  });

  it("renders batch enrich actions and feedback for selected channels", () => {
    const html = renderView(
      {
        status: "ready",
        data: pagedChannels,
        error: null,
      },
      {
        selectedChannelIds: [pagedChannels.items[0]!.id, "sticky-selection"],
        batchEnrichmentActionState: {
          type: "success",
          message: "Queued 2 channels for enrichment. The table refreshes automatically while jobs run.",
        },
      },
    );

    expect(html).toContain("Enrich selected (2)");
    expect(html).toContain("Export selected (2)");
    expect(html).not.toContain("Delete selected");
    expect(html).not.toContain("Push to HubSpot");
    expect(html).toContain(
      "Queued 2 channels for enrichment. The table refreshes automatically while jobs run.",
    );
    expect(html).toContain("catalog-table__selection-status--success");
  });

  it("renders admin-only channel delete action and feedback", () => {
    const html = renderView(
      {
        status: "ready",
        data: pagedChannels,
        error: null,
      },
      {
        isAdmin: true,
        selectedChannelIds: [pagedChannels.items[0]!.id, "sticky-selection"],
        deleteActionState: {
          type: "error",
          message: "One or more selected channels are linked to runs or HubSpot batches and cannot be deleted.",
        },
      },
    );

    expect(html).toContain("Delete selected (2)");
    expect(html).toContain(
      "One or more selected channels are linked to runs or HubSpot batches and cannot be deleted.",
    );
    expect(html).toContain("catalog-table__selection-status--error");
  });

  it("does not render the recent exports cards section", () => {
    const html = renderView(
      {
        status: "ready",
        data: pagedChannels,
        error: null,
      },
      {
        selectedChannelIds: [],
        latestCsvExportBatch: {
          requestState: "ready",
          summary: buildBatchSummaryPayloadForCatalogTests({
            id: "0612f7d5-70b2-402b-9151-a98ec850c8cb",
            status: "completed",
            rowCount: 2,
            fileName: "selected-creators.csv",
          }),
          detail: {
            ...buildBatchSummaryPayloadForCatalogTests({
              id: "0612f7d5-70b2-402b-9151-a98ec850c8cb",
              status: "completed",
              rowCount: 2,
              fileName: "selected-creators.csv",
            }),
            scope: {
              type: "selected",
              channelIds: [
                "50cb8343-229e-4f4c-9d8d-c17297f91288",
                "e11e5184-79a2-42bf-bceb-345f30611c39",
              ],
            },
          } satisfies CsvExportBatchDetail,
          error: null,
          isRefreshing: false,
        },
      },
    );

    expect(html).not.toContain("Recent exports");
    expect(html).not.toContain("CSV export");
    expect(html).not.toContain("Download CSV");
    expect(html).not.toContain("Failed rows");
    expect(html).not.toContain("Push to HubSpot");
  });
});

function buildBatchSummaryPayloadForCatalogTests(
  overrides?: Partial<CsvExportBatchSummary>,
): CsvExportBatchSummary {
  return {
    id: "0612f7d5-70b2-402b-9151-a98ec850c8cb",
    scopeType: "selected" as const,
    fileName: "selected-creators.csv",
    schemaVersion: "v1",
    status: "queued" as const,
    rowCount: 0,
    lastError: null,
    requestedBy: {
      id: "58825d8b-f806-4480-b23d-b23773cde596",
      email: "manager@example.com",
      name: "Manager",
    },
    createdAt: "2026-03-13T09:00:00.000Z",
    updatedAt: "2026-03-13T09:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}
