import type {
  ChannelEnrichmentStatus,
  ListChannelsResponse,
  SegmentResponse,
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
  getEmptyCatalogMessage,
  getNextCatalogPage,
  getPreviousCatalogPage,
  hasNextCatalogPage,
  hasPreviousCatalogPage,
  parseCatalogUrlState,
  toggleCatalogChannelSelection,
  toggleCatalogPageSelection,
  toggleCatalogStatusFilter,
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

const defaultSavedSegments: SegmentResponse[] = [
  {
    id: "8fcaf11c-d515-4135-817f-3f98b4f3cb7e",
    name: "Space creators",
    filters: {
      query: "space",
      enrichmentStatus: ["completed"],
      advancedReportStatus: ["pending_approval"],
    },
    createdAt: "2026-03-08T10:00:00.000Z",
    updatedAt: "2026-03-08T10:00:00.000Z",
  },
];

function renderView(
  requestState: Parameters<typeof CatalogTableShellView>[0]["requestState"],
  options?: {
    selectedChannelIds?: string[];
    savedSegments?: SegmentResponse[];
    savedSegmentsRequestState?: Parameters<typeof CatalogTableShellView>[0]["savedSegmentsRequestState"];
    savedSegmentName?: string;
    savedSegmentOperationStatus?: Parameters<
      typeof CatalogTableShellView
    >[0]["savedSegmentOperationStatus"];
    pendingSegmentAction?: string | null;
  },
): string {
  return renderToStaticMarkup(
    createElement(CatalogTableShellView, {
      draftFilters: {
        query: "space",
        enrichmentStatus: ["completed"],
        advancedReportStatus: ["pending_approval"],
      },
      selectedChannelIds: options?.selectedChannelIds ?? [],
      savedSegments: options?.savedSegments ?? defaultSavedSegments,
      savedSegmentsRequestState: options?.savedSegmentsRequestState ?? {
        status: "ready",
        error: null,
      },
      savedSegmentName: options?.savedSegmentName ?? "",
      savedSegmentOperationStatus: options?.savedSegmentOperationStatus ?? {
        type: "idle",
        message: "",
      },
      pendingSegmentAction: options?.pendingSegmentAction ?? null,
      requestState,
      hasPendingFilterChanges: true,
      onCreateSegment: vi.fn(),
      onDeleteSegment: vi.fn(),
      onApplyFilters: vi.fn(),
      onClearSelection: vi.fn(),
      onDraftQueryChange: vi.fn(),
      onLoadSegment: vi.fn(),
      onNextPage: vi.fn(),
      onPreviousPage: vi.fn(),
      onResetFilters: vi.fn(),
      onRetrySavedSegments: vi.fn(),
      onRetry: vi.fn(),
      onSavedSegmentNameChange: vi.fn(),
      onToggleAdvancedReportStatus: vi.fn(),
      onToggleChannelSelection: vi.fn(),
      onToggleEnrichmentStatus: vi.fn(),
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
      "page=3&query=space&enrichmentStatus=failed&enrichmentStatus=completed&advancedReportStatus=stale",
    );

    const parsed = parseCatalogUrlState(searchParams);

    expect(parsed).toEqual({
      page: 3,
      filters: {
        query: "space",
        enrichmentStatus: ["completed", "failed"],
        advancedReportStatus: ["stale"],
      },
    });

    expect(buildCatalogSearchParams(parsed).toString()).toBe(
      "page=3&query=space&enrichmentStatus=completed&enrichmentStatus=failed&advancedReportStatus=stale",
    );
    expect(buildCatalogHref("/catalog", parsed)).toBe(
      "/catalog?page=3&query=space&enrichmentStatus=completed&enrichmentStatus=failed&advancedReportStatus=stale",
    );
    expect(
      areCatalogFiltersEqual(parsed.filters, {
        query: "space",
        enrichmentStatus: ["completed", "failed"],
        advancedReportStatus: ["stale"],
      }),
    ).toBe(true);
  });

  it("toggles status filters while preserving current selections", () => {
    const afterAdd = toggleCatalogStatusFilter(["completed"], "failed");
    expect(afterAdd).toEqual(["completed", "failed"]);

    const afterRemove = toggleCatalogStatusFilter(afterAdd, "completed");
    expect(afterRemove).toEqual(["failed"]);
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

  it("round-trips saved segment filters into catalog filter state", () => {
    const filters = buildSavedSegmentFilters({
      query: "  space  ",
      enrichmentStatus: ["failed", "completed"],
      advancedReportStatus: ["stale"],
    });

    expect(filters).toEqual({
      query: "space",
      enrichmentStatus: ["completed", "failed"],
      advancedReportStatus: ["stale"],
    });
    expect(getCatalogFiltersFromSavedSegment(filters)).toEqual({
      query: "space",
      enrichmentStatus: ["completed", "failed"],
      advancedReportStatus: ["stale"],
    });
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

    expect(html).toContain("Saved segments");
    expect(html).toContain("Filters");
    expect(html).toContain("Apply filters");
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

  it("renders saved segment actions and summaries", () => {
    const html = renderView(
      {
        status: "ready",
        data: {
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
        },
        error: null,
      },
      {
        savedSegmentName: "Space creators",
      },
    );

    expect(html).toContain("Save current filters");
    expect(html).toContain("Space creators");
    expect(html).toContain("Search: space");
    expect(html).toContain("Enrichment: Ready");
    expect(html).toContain("Report: Pending approval");
    expect(html).toContain(">Load</button>");
    expect(html).toContain(">Delete</button>");
  });

  it("renders saved segment loading and empty states", () => {
    const loadingHtml = renderView(
      {
        status: "ready",
        data: {
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
        },
        error: null,
      },
      {
        savedSegments: [],
        savedSegmentsRequestState: {
          status: "loading",
          error: null,
        },
      },
    );

    expect(loadingHtml).toContain("Loading saved segments...");

    const emptyHtml = renderView(
      {
        status: "ready",
        data: {
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
        },
        error: null,
      },
      {
        savedSegments: [],
        savedSegmentsRequestState: {
          status: "ready",
          error: null,
        },
      },
    );

    expect(emptyHtml).toContain("No saved segments yet.");
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

    expect(html).toContain("Filters active");
    expect(html).toContain("0 channels");
    expect(html).toContain("No channels match the current filters.");
    expect(html).toContain("Page 1");
    expect(html).toContain(">Previous</button>");
    expect(html).toContain(">Next</button>");
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

    for (const [, label] of statuses) {
      expect(html).toContain(label);
    }

    expect(html).toContain("value=\"space\"");
    expect(html).toContain("Pending approval");
    expect(html).toContain("href=\"/catalog/00000000-0000-0000-0000-000000000001\"");
    expect(html).toContain("Open channel");
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
});
