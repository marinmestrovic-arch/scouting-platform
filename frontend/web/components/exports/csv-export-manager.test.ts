import type { CsvExportBatchSummary } from "@scouting-platform/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: "a",
}));

import {
  CsvExportManagerView,
  formatCsvExportBatchStatusLabel,
  shouldPollCsvExportBatches,
} from "./csv-export-manager";

function buildSummary(overrides?: Partial<CsvExportBatchSummary>): CsvExportBatchSummary {
  return {
    id: "99d39ccb-3cf5-4f09-a647-a0e1387d31cb",
    scopeType: "filtered",
    fileName: "space-creators.csv",
    schemaVersion: "v1",
    status: "queued",
    rowCount: 12,
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

function buildFilters(
  overrides?: Partial<Parameters<typeof CsvExportManagerView>[0]["filters"]>,
): Parameters<typeof CsvExportManagerView>[0]["filters"] {
  return {
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
    ...overrides,
  };
}

describe("csv export manager view", () => {
  it("renders loading history and filter creation controls", () => {
    const html = renderToStaticMarkup(
      createElement(CsvExportManagerView, {
        catalogHref: "/catalog?page=1&query=space&countryRegion=Croatia",
        createState: {
          type: "idle",
          message: "",
        },
        filters: buildFilters({
          query: "space",
          countryRegion: ["Croatia"],
        }),
        hasActiveFilters: true,
        historyState: {
          status: "loading",
          items: [],
          error: null,
        },
        isRefreshing: false,
        onCreateFilteredExport: vi.fn(),
        onMultiValueFilterTextChange: vi.fn(),
        onNumericFilterChange: vi.fn(),
        onQueryChange: vi.fn(),
        onReloadHistory: vi.fn(),
        onResetFilters: vi.fn(),
        onRetryHistory: vi.fn(),
      }),
    );

    expect(html).toContain("Create filtered export");
    expect(html).toContain("Loading CSV export history...");
    expect(html).toContain(
      'href="/catalog?page=1&amp;query=space&amp;countryRegion=Croatia"',
    );
  });

  it("renders completed downloads and failed history feedback", () => {
    const html = renderToStaticMarkup(
      createElement(CsvExportManagerView, {
        catalogHref: "/catalog?page=1",
        createState: {
          type: "success",
          message: "Filtered CSV export queued. History refreshes automatically while processing continues.",
        },
        filters: buildFilters(),
        hasActiveFilters: false,
        historyState: {
          status: "ready",
          items: [
            buildSummary({
              status: "completed",
              completedAt: "2026-03-13T09:05:00.000Z",
            }),
            buildSummary({
              id: "d5339bed-7f19-4bcc-8ce2-24dfe651d28e",
              scopeType: "selected",
              fileName: "selected-creators.csv",
              status: "failed",
              lastError: "Export queue unavailable",
              rowCount: 3,
            }),
          ],
          error: null,
        },
        isRefreshing: true,
        onCreateFilteredExport: vi.fn(),
        onMultiValueFilterTextChange: vi.fn(),
        onNumericFilterChange: vi.fn(),
        onQueryChange: vi.fn(),
        onReloadHistory: vi.fn(),
        onResetFilters: vi.fn(),
        onRetryHistory: vi.fn(),
      }),
    );

    expect(html).toContain("Refreshing export history...");
    expect(html).toContain("Filtered export");
    expect(html).toContain("Selected export");
    expect(html).toContain("Open batch result");
    expect(html).toContain('href="/exports/99d39ccb-3cf5-4f09-a647-a0e1387d31cb"');
    expect(html).toContain("Download CSV");
    expect(html).toContain("Export queue unavailable");
    expect(html).toContain(
      'href="/api/csv-export-batches/99d39ccb-3cf5-4f09-a647-a0e1387d31cb/download"',
    );
  });

  it("renders empty history state when no export batches exist", () => {
    const html = renderToStaticMarkup(
      createElement(CsvExportManagerView, {
        catalogHref: "/catalog",
        createState: {
          type: "error",
          message: "Choose at least one filter before creating a filtered export.",
        },
        filters: buildFilters(),
        hasActiveFilters: false,
        historyState: {
          status: "ready",
          items: [],
          error: null,
        },
        isRefreshing: false,
        onCreateFilteredExport: vi.fn(),
        onMultiValueFilterTextChange: vi.fn(),
        onNumericFilterChange: vi.fn(),
        onQueryChange: vi.fn(),
        onReloadHistory: vi.fn(),
        onResetFilters: vi.fn(),
        onRetryHistory: vi.fn(),
      }),
    );

    expect(html).toContain("No export history yet");
    expect(html).toContain("Choose at least one filter before creating a filtered export.");
  });
});

describe("csv export manager helpers", () => {
  it("formats status labels", () => {
    expect(formatCsvExportBatchStatusLabel("queued")).toBe("Queued");
    expect(formatCsvExportBatchStatusLabel("completed")).toBe("Completed");
  });

  it("polls only queued or running history items", () => {
    expect(shouldPollCsvExportBatches([buildSummary({ status: "completed" })])).toBe(false);
    expect(shouldPollCsvExportBatches([buildSummary({ status: "running" })])).toBe(true);
  });
});
