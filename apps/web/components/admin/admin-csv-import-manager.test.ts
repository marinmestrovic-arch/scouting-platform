import type {
  CsvImportBatchDetail,
  CsvImportBatchSummary,
} from "@scouting-platform/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: "a",
}));

import {
  AdminCsvImportManagerView,
  getAdminCsvImportStatusLabel,
  shouldPollAdminCsvImportDetail,
  shouldPollAdminCsvImportList,
} from "./admin-csv-import-manager";

function buildSummary(overrides?: Partial<CsvImportBatchSummary>): CsvImportBatchSummary {
  return {
    id: "61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d",
    fileName: "contacts.csv",
    templateVersion: "v1",
    status: "queued",
    totalRowCount: 2,
    importedRowCount: 0,
    failedRowCount: 1,
    lastError: null,
    requestedBy: {
      id: "ee8827ee-53df-4eef-aa7b-67218ef25f91",
      email: "admin@example.com",
      name: "Admin",
    },
    createdAt: "2026-03-11T09:00:00.000Z",
    updatedAt: "2026-03-11T09:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function buildDetail(overrides?: Partial<CsvImportBatchDetail>): CsvImportBatchDetail {
  return {
    ...buildSummary(),
    page: 1,
    pageSize: 100,
    rows: [
      {
        id: "afcdbdf7-cbb3-4947-8eef-2ff73b19b0b4",
        rowNumber: 2,
        status: "imported",
        youtubeChannelId: "UC-CSV-1",
        channelTitle: "Imported Creator",
        contactEmail: "creator@example.com",
        firstName: "Imported",
        lastName: "Creator",
        subscriberCount: "1000",
        viewCount: "20000",
        videoCount: "50",
        notes: "Imported from ops sheet",
        sourceLabel: "ops",
        channelId: "58f68d7a-c916-4b13-8afa-61845e490463",
        errorMessage: null,
      },
      {
        id: "7e06890d-2642-4a00-8f2b-b48d8ea12f65",
        rowNumber: 3,
        status: "failed",
        youtubeChannelId: "UC-CSV-2",
        channelTitle: "Failed Creator",
        contactEmail: null,
        firstName: null,
        lastName: null,
        subscriberCount: null,
        viewCount: null,
        videoCount: null,
        notes: null,
        sourceLabel: "ops",
        channelId: null,
        errorMessage: "contactEmail is invalid",
      },
    ],
    ...overrides,
  };
}

describe("admin csv import manager view", () => {
  it("renders upload guidance, loading state, and idle detail selection", () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImportManagerView, {
        detailState: { status: "idle", data: null, error: null },
        fileInputResetToken: 0,
        isRefreshingDetail: false,
        isRefreshingList: false,
        listState: { status: "loading", items: [], error: null },
        onFileChange: vi.fn(),
        onNextPage: vi.fn(),
        onPreviousPage: vi.fn(),
        onReload: vi.fn(),
        onRetryDetail: vi.fn(),
        onRetryList: vi.fn(),
        onSelectBatch: vi.fn(),
        onUpload: vi.fn(),
        selectedBatchId: null,
        selectedFileName: "",
        uploadState: { type: "idle", message: "" },
      }),
    );

    expect(html).toContain("Upload CSV");
    expect(html).toContain("youtubeChannelId,channelTitle,contactEmail,firstName,lastName,subscriberCount,viewCount,videoCount,notes,sourceLabel");
    expect(html).toContain("Maximum file size 5 MiB. Up to 10000 data rows per batch.");
    expect(html).toContain("Loading CSV import batches...");
    expect(html).toContain("Select an import batch");
    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/admin/users"');
  });

  it("renders ready detail with failed rows, pagination, and refresh copy", () => {
    const detail = buildDetail({
      status: "running",
      startedAt: "2026-03-11T09:05:00.000Z",
    });
    const html = renderToStaticMarkup(
      createElement(AdminCsvImportManagerView, {
        detailState: { status: "ready", data: detail, error: null },
        fileInputResetToken: 1,
        isRefreshingDetail: true,
        isRefreshingList: true,
        listState: { status: "ready", items: [buildSummary()], error: null },
        onFileChange: vi.fn(),
        onNextPage: vi.fn(),
        onPreviousPage: vi.fn(),
        onReload: vi.fn(),
        onRetryDetail: vi.fn(),
        onRetryList: vi.fn(),
        onSelectBatch: vi.fn(),
        onUpload: vi.fn(),
        selectedBatchId: detail.id,
        selectedFileName: "contacts.csv",
        uploadState: { type: "success", message: "CSV import queued. Row results refresh automatically while processing continues." },
      }),
    );

    expect(html).toContain("Selected file: contacts.csv");
    expect(html).toContain("Refreshing imports...");
    expect(html).toContain("Refreshing selected batch...");
    expect(html).toContain("Imported Creator");
    expect(html).toContain("Failed Creator");
    expect(html).toContain("contactEmail is invalid");
    expect(html).toContain("Page 1 of 1. Showing rows 1-2 of 2.");
    expect(html).toContain("Previous page");
    expect(html).toContain("Next page");
    expect(html).toContain("admin-csv-imports__table-row--failed");
  });

  it("renders empty state when there are no batches", () => {
    const html = renderToStaticMarkup(
      createElement(AdminCsvImportManagerView, {
        detailState: { status: "idle", data: null, error: null },
        fileInputResetToken: 0,
        isRefreshingDetail: false,
        isRefreshingList: false,
        listState: { status: "ready", items: [], error: null },
        onFileChange: vi.fn(),
        onNextPage: vi.fn(),
        onPreviousPage: vi.fn(),
        onReload: vi.fn(),
        onRetryDetail: vi.fn(),
        onRetryList: vi.fn(),
        onSelectBatch: vi.fn(),
        onUpload: vi.fn(),
        selectedBatchId: null,
        selectedFileName: "",
        uploadState: { type: "idle", message: "" },
      }),
    );

    expect(html).toContain("No imports yet");
    expect(html).toContain("Upload the first strict-template CSV batch to start building import history.");
  });
});

describe("admin csv import manager helpers", () => {
  it("formats status labels", () => {
    expect(getAdminCsvImportStatusLabel("queued")).toBe("Queued");
    expect(getAdminCsvImportStatusLabel("failed")).toBe("Failed");
  });

  it("polls only queued or running batches", () => {
    expect(shouldPollAdminCsvImportList([buildSummary({ status: "completed" })])).toBe(false);
    expect(shouldPollAdminCsvImportList([buildSummary({ status: "running" })])).toBe(true);
    expect(shouldPollAdminCsvImportDetail(buildDetail({ status: "queued" }))).toBe(true);
    expect(shouldPollAdminCsvImportDetail(buildDetail({ status: "failed" }))).toBe(false);
  });
});
