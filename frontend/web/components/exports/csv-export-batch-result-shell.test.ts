import type { CsvExportBatchDetail } from "@scouting-platform/contracts";
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

vi.mock("../../lib/csv-export-batches-api", () => ({
  CsvExportBatchesApiError: class CsvExportBatchesApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "CsvExportBatchesApiError";
      this.status = status;
    }
  },
  fetchCsvExportBatchDetail: vi.fn(),
  getCsvExportBatchDownloadUrl: vi.fn((batchId: string) => `/api/csv-export-batches/${batchId}/download`),
}));

import { CsvExportBatchesApiError } from "../../lib/csv-export-batches-api";
import {
  CsvExportBatchResultShellView,
  formatCsvExportBatchStatusLabel,
  getCsvExportBatchDetailRequestErrorMessage,
  shouldPollCsvExportBatchResult,
} from "./csv-export-batch-result-shell";

function buildDetail(overrides?: Partial<CsvExportBatchDetail>): CsvExportBatchDetail {
  return {
    id: "99d39ccb-3cf5-4f09-a647-a0e1387d31cb",
    scopeType: "filtered",
    fileName: "space-creators.csv",
    schemaVersion: "v1",
    status: "completed",
    rowCount: 12,
    lastError: null,
    requestedBy: {
      id: "58825d8b-f806-4480-b23d-b23773cde596",
      email: "manager@example.com",
      name: "Manager",
    },
    createdAt: "2026-03-13T09:00:00.000Z",
    updatedAt: "2026-03-13T09:02:00.000Z",
    startedAt: "2026-03-13T09:01:00.000Z",
    completedAt: "2026-03-13T09:02:00.000Z",
    scope: {
      type: "filtered",
      filters: {
        query: "space",
        countryRegion: ["Croatia"],
        influencerVertical: ["Gaming"],
        youtubeVideoMedianViewsMin: 100000,
      },
    },
    ...overrides,
  };
}

function renderView(requestState: Parameters<typeof CsvExportBatchResultShellView>[0]["requestState"]) {
  return renderToStaticMarkup(
    createElement(CsvExportBatchResultShellView, {
      batchId: "99d39ccb-3cf5-4f09-a647-a0e1387d31cb",
      isRefreshing: true,
      onRetry: () => undefined,
      requestState,
    }),
  );
}

describe("csv export batch result shell", () => {
  it("formats status labels and polls only active batch states", () => {
    expect(formatCsvExportBatchStatusLabel("queued")).toBe("Queued");
    expect(formatCsvExportBatchStatusLabel("failed")).toBe("Failed");
    expect(shouldPollCsvExportBatchResult(buildDetail({ status: "running" }))).toBe(true);
    expect(shouldPollCsvExportBatchResult(buildDetail({ status: "completed" }))).toBe(false);
  });

  it("maps session errors to actionable detail copy", () => {
    expect(
      getCsvExportBatchDetailRequestErrorMessage(
        new CsvExportBatchesApiError("Forbidden", 403),
      ),
    ).toBe(
      "Your session does not allow access to this CSV export batch anymore. Sign in again and retry.",
    );
  });

  it("renders loading and not-found states", () => {
    const loadingHtml = renderView({
      requestState: "loading",
      data: null,
      error: null,
    });
    const notFoundHtml = renderView({
      requestState: "notFound",
      data: null,
      error: null,
    });

    expect(loadingHtml).toContain("Loading CSV export batch");
    expect(notFoundHtml).toContain("CSV export batch not found");
  });

  it("renders batch summary, stored scope, and result actions", () => {
    const html = renderView({
      requestState: "ready",
      data: buildDetail(),
      error: "Temporary refresh error",
    });

    expect(html).toContain("space-creators.csv");
    expect(html).toContain("The export completed and the stored CSV artifact is ready for download.");
    expect(html).toContain("Refreshing batch result...");
    expect(html).toContain("Batch summary");
    expect(html).toContain("Filtered scope snapshot");
    expect(html).toContain("Search: space");
    expect(html).toContain("Country/Region");
    expect(html).toContain("Croatia");
    expect(html).toContain("Influencer Vertical");
    expect(html).toContain("Gaming");
    expect(html).toContain("Video Median Views");
    expect(html).toContain("&gt;= 100,000");
    expect(html).toContain("schema v1");
    expect(html).toContain("Last refresh failed: Temporary refresh error");
    expect(html).toContain('href="/exports"');
    expect(html).toContain(
      'href="/catalog?page=1&amp;query=space&amp;countryRegion=Croatia&amp;influencerVertical=Gaming&amp;youtubeVideoMedianViewsMin=100000"',
    );
    expect(html).toContain(
      'href="/api/csv-export-batches/99d39ccb-3cf5-4f09-a647-a0e1387d31cb/download"',
    );
  });
});
