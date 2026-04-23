import type {
  CsvImportBatchDetail,
  CsvImportBatchSummary,
} from "@scouting-platform/contracts";
import { CSV_IMPORT_HEADER } from "@scouting-platform/contracts";
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
    templateVersion: "v3",
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
        hubspotRecordId: "111",
        timestampImported: null,
        channelUrl: "https://www.youtube.com/channel/UC-CSV-1",
        campaignName: null,
        dealOwner: null,
        handoffStatus: null,
        contactEmail: "creator@example.com",
        phoneNumber: "+385 111 222",
        currency: "EUR",
        dealType: "Paid",
        contactType: null,
        month: null,
        year: null,
        clientName: null,
        dealName: null,
        activationName: null,
        pipeline: null,
        dealStage: null,
        firstName: "Imported",
        lastName: "Creator",
        youtubeHandle: "@imported",
        youtubeUrl: "https://www.youtube.com/@imported",
        subscriberCount: "1000",
        viewCount: null,
        videoCount: null,
        youtubeVideoMedianViews: "20000",
        youtubeShortsMedianViews: "14000",
        youtubeEngagementRate: "3.5",
        youtubeFollowers: "1000",
        instagramHandle: "@imported_ig",
        instagramUrl: "https://www.instagram.com/imported_ig",
        instagramPostAverageViews: "18000",
        instagramReelAverageViews: "22000",
        instagramStory7DayAverageViews: "9500",
        instagramStory30DayAverageViews: "8100",
        instagramEngagementRate: "4.2",
        instagramFollowers: "250000",
        tiktokHandle: "@imported_tt",
        tiktokUrl: "https://www.tiktok.com/@imported_tt",
        tiktokAverageViews: "64000",
        tiktokEngagementRate: "5.4",
        tiktokFollowers: "310000",
        twitchHandle: "imported_live",
        twitchUrl: "https://www.twitch.tv/imported_live",
        twitchAverageViews: "4300",
        twitchEngagementRate: "2.8",
        twitchFollowers: "98000",
        kickHandle: "importedkick",
        kickUrl: "https://kick.com/importedkick",
        kickAverageViews: "3100",
        kickEngagementRate: "2.2",
        kickFollowers: "44000",
        xHandle: "@importedx",
        xUrl: "https://x.com/importedx",
        xAverageViews: "56000",
        xEngagementRate: "1.7",
        xFollowers: "129000",
        notes: "Imported from ops sheet",
        sourceLabel: "ops",
        influencerType: "Male",
        influencerVertical: "Gaming",
        countryRegion: "Croatia",
        language: "Croatian",
        channelId: "58f68d7a-c916-4b13-8afa-61845e490463",
        errorMessage: null,
      },
      {
        id: "7e06890d-2642-4a00-8f2b-b48d8ea12f65",
        rowNumber: 3,
        status: "failed",
        youtubeChannelId: "",
        channelTitle: "Failed Creator",
        hubspotRecordId: null,
        timestampImported: null,
        channelUrl: null,
        campaignName: null,
        dealOwner: null,
        handoffStatus: null,
        contactEmail: "invalid-email",
        phoneNumber: null,
        currency: null,
        dealType: null,
        contactType: null,
        month: null,
        year: null,
        clientName: null,
        dealName: null,
        activationName: null,
        pipeline: null,
        dealStage: null,
        firstName: null,
        lastName: null,
        youtubeHandle: null,
        youtubeUrl: null,
        subscriberCount: null,
        viewCount: null,
        videoCount: null,
        youtubeVideoMedianViews: null,
        youtubeShortsMedianViews: null,
        youtubeEngagementRate: null,
        youtubeFollowers: null,
        instagramHandle: null,
        instagramUrl: null,
        instagramPostAverageViews: null,
        instagramReelAverageViews: null,
        instagramStory7DayAverageViews: null,
        instagramStory30DayAverageViews: null,
        instagramEngagementRate: null,
        instagramFollowers: null,
        tiktokHandle: null,
        tiktokUrl: null,
        tiktokAverageViews: null,
        tiktokEngagementRate: null,
        tiktokFollowers: null,
        twitchHandle: null,
        twitchUrl: null,
        twitchAverageViews: null,
        twitchEngagementRate: null,
        twitchFollowers: null,
        kickHandle: null,
        kickUrl: null,
        kickAverageViews: null,
        kickEngagementRate: null,
        kickFollowers: null,
        xHandle: null,
        xUrl: null,
        xAverageViews: null,
        xEngagementRate: null,
        xFollowers: null,
        notes: null,
        sourceLabel: "ops",
        influencerType: null,
        influencerVertical: null,
        countryRegion: null,
        language: null,
        channelId: null,
        errorMessage: "Email is invalid",
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
    expect(html).toContain(CSV_IMPORT_HEADER.join(","));
    expect(html).toContain("Creator List / HubSpot export CSV format");
    expect(html).toContain("must match the saved creator profile values");
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
        uploadState: {
          type: "success",
          message: "CSV import queued. Row results refresh automatically while processing continues.",
        },
      }),
    );

    expect(html).toContain("Selected file: contacts.csv");
    expect(html).toContain("Refreshing imports...");
    expect(html).toContain("Refreshing selected batch...");
    expect(html).toContain("Imported Creator");
    expect(html).toContain("Failed Creator");
    expect(html).toContain("Email is invalid");
    expect(html).toContain("Type Male");
    expect(html).toContain("Followers 1000");
    expect(html).toContain("Channel URL https://www.youtube.com/channel/UC-CSV-1");
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
    expect(html).toContain(
      "Upload the first Creator List / HubSpot CSV batch to start building import history.",
    );
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
