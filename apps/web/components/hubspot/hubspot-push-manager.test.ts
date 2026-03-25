import type {
  HubspotImportBatchDetail,
  HubspotImportBatchSummary,
  HubspotPushBatchDetail,
  HubspotPushBatchSummary,
} from "@scouting-platform/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: "a",
}));

import {
  buildHubspotPushWorkspaceHref,
  formatHubspotPushStatusLabel,
  HubspotPushManagerView,
  shouldPollHubspotPushDetail,
  shouldPollHubspotPushHistory,
} from "./hubspot-push-manager";

function buildImportSummary(
  overrides?: Partial<HubspotImportBatchSummary>,
): HubspotImportBatchSummary {
  return {
    id: "fdd240f2-ef31-43fe-b1d2-a584951654a8",
    run: {
      id: "57c8b6a1-85cf-4f51-a510-43fd61026f29",
      name: "Spring gaming outreach",
    },
    fileName: "spring-gaming-outreach-hubspot.csv",
    schemaVersion: "week7-hubspot-import-v1",
    status: "queued",
    totalRowCount: 2,
    preparedRowCount: 0,
    failedRowCount: 0,
    lastError: null,
    requestedBy: {
      id: "8c1136b4-1c95-4e8c-aefe-0e58df0a39d5",
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

function buildImportDetail(
  overrides?: Partial<HubspotImportBatchDetail>,
): HubspotImportBatchDetail {
  return {
    ...buildImportSummary({
      status: "completed",
      preparedRowCount: 1,
      failedRowCount: 1,
      completedAt: "2026-03-13T09:02:00.000Z",
      ...overrides,
    }),
    rows: [
      {
        id: "28ada809-e597-483e-9a7f-f568fc2f80dd",
        channelId: "14e40450-71c2-4e0e-a160-b787d21843fd",
        channelTitle: "Imported Creator",
        contactEmail: "creator@example.com",
        firstName: "Imported",
        lastName: "Creator",
        influencerType: "Creator",
        influencerVertical: "Gaming",
        countryRegion: "Germany",
        language: "German",
        status: "prepared",
        errorMessage: null,
        createdAt: "2026-03-13T09:00:00.000Z",
        updatedAt: "2026-03-13T09:01:00.000Z",
      },
      {
        id: "7399dc95-9ab0-4526-abfa-5da78000b3ab",
        channelId: "f3d0fbec-f8a0-40ad-8e19-2370c6b99083",
        channelTitle: "Blocked Creator",
        contactEmail: "blocked@example.com",
        firstName: "Blocked",
        lastName: "Creator",
        influencerType: "Creator",
        influencerVertical: "Gaming",
        countryRegion: "Austria",
        language: "German",
        status: "failed",
        errorMessage: "Last Name is required",
        createdAt: "2026-03-13T09:00:00.000Z",
        updatedAt: "2026-03-13T09:01:00.000Z",
      },
    ],
  };
}

function buildLegacySummary(
  overrides?: Partial<HubspotPushBatchSummary>,
): HubspotPushBatchSummary {
  return {
    id: "afef11a2-ef31-43fe-b1d2-a584951654a8",
    status: "completed",
    totalRowCount: 2,
    pushedRowCount: 1,
    failedRowCount: 1,
    lastError: null,
    requestedBy: {
      id: "8c1136b4-1c95-4e8c-aefe-0e58df0a39d5",
      email: "manager@example.com",
      name: "Manager",
    },
    createdAt: "2026-03-12T09:00:00.000Z",
    updatedAt: "2026-03-12T09:02:00.000Z",
    startedAt: "2026-03-12T09:01:00.000Z",
    completedAt: "2026-03-12T09:02:00.000Z",
    ...overrides,
  };
}

function buildLegacyDetail(
  overrides?: Partial<HubspotPushBatchDetail>,
): HubspotPushBatchDetail {
  return {
    ...buildLegacySummary(overrides),
    scope: {
      channelIds: [
        "14e40450-71c2-4e0e-a160-b787d21843fd",
        "f3d0fbec-f8a0-40ad-8e19-2370c6b99083",
      ],
    },
    rows: [
      {
        id: "28ada809-e597-483e-9a7f-f568fc2f80dd",
        channelId: "14e40450-71c2-4e0e-a160-b787d21843fd",
        contactEmail: "creator@example.com",
        status: "pushed",
        hubspotObjectId: "hubspot-contact-1",
        errorMessage: null,
        createdAt: "2026-03-12T09:00:00.000Z",
        updatedAt: "2026-03-12T09:01:00.000Z",
      },
      {
        id: "7399dc95-9ab0-4526-abfa-5da78000b3ab",
        channelId: "f3d0fbec-f8a0-40ad-8e19-2370c6b99083",
        contactEmail: null,
        status: "failed",
        hubspotObjectId: null,
        errorMessage: "Channel has no contact email",
        createdAt: "2026-03-12T09:00:00.000Z",
        updatedAt: "2026-03-12T09:01:00.000Z",
      },
    ],
  };
}

describe("hubspot push manager view", () => {
  it("renders loading history and idle detail states", () => {
    const html = renderToStaticMarkup(
      createElement(HubspotPushManagerView, {
        catalogHref: "/database?tab=runs",
        detailState: {
          requestState: "idle",
          data: null,
          error: null,
        },
        historyState: {
          status: "loading",
          items: [],
          error: null,
        },
        isRefreshingDetail: false,
        isRefreshingHistory: false,
        onReloadHistory: vi.fn(),
        onRetryDetail: vi.fn(),
        onRetryHistory: vi.fn(),
        onSelectBatch: vi.fn(),
        selectedBatchId: null,
      }),
    );

    expect(html).toContain("HubSpot import batches");
    expect(html).toContain("Loading HubSpot import history...");
    expect(html).toContain("Select a HubSpot batch");
    expect(html).toContain('href="/database?tab=runs"');
  });

  it("renders the empty history state with a database link", () => {
    const html = renderToStaticMarkup(
      createElement(HubspotPushManagerView, {
        catalogHref: "/database?tab=runs",
        detailState: {
          requestState: "idle",
          data: null,
          error: null,
        },
        historyState: {
          status: "ready",
          items: [],
          error: null,
        },
        isRefreshingDetail: false,
        isRefreshingHistory: false,
        onReloadHistory: vi.fn(),
        onRetryDetail: vi.fn(),
        onRetryHistory: vi.fn(),
        onSelectBatch: vi.fn(),
        selectedBatchId: null,
      }),
    );

    expect(html).toContain("No HubSpot import history yet");
    expect(html).toContain("Open Database");
    expect(html).toContain('href="/database?tab=runs"');
  });

  it("renders selected import detail, download actions, and stored row failures", () => {
    const detail = buildImportDetail();
    const html = renderToStaticMarkup(
      createElement(HubspotPushManagerView, {
        catalogHref: "/database?tab=runs",
        detailState: {
          requestState: "ready",
          data: { kind: "import", batch: detail },
          error: "Temporary refresh error",
        },
        historyState: {
          status: "ready",
          items: [
            {
              kind: "import",
              summary: buildImportSummary({
                id: detail.id,
                status: "completed",
                preparedRowCount: 1,
                failedRowCount: 1,
                completedAt: "2026-03-13T09:02:00.000Z",
              }),
            },
            {
              kind: "legacy",
              summary: buildLegacySummary(),
            },
          ],
          error: "History refresh failed",
        },
        isRefreshingDetail: true,
        isRefreshingHistory: true,
        onReloadHistory: vi.fn(),
        onRetryDetail: vi.fn(),
        onRetryHistory: vi.fn(),
        onSelectBatch: vi.fn(),
        selectedBatchId: detail.id,
      }),
    );

    expect(html).toContain("Refreshing HubSpot history...");
    expect(html).toContain("Refreshing selected batch...");
    expect(html).toContain("hubspot-push__list-item hubspot-push__list-item--selected");
    expect(html).toContain("Import-ready CSV");
    expect(html).toContain("Download CSV");
    expect(html).toContain("Open batch result");
    expect(html).toContain(
      'href="/api/hubspot-import-batches/fdd240f2-ef31-43fe-b1d2-a584951654a8/download"',
    );
    expect(html).toContain('href="/hubspot/fdd240f2-ef31-43fe-b1d2-a584951654a8"');
    expect(html).toContain("Imported Creator");
    expect(html).toContain("Last Name is required");
    expect(html).toContain("Last refresh failed: History refresh failed");
    expect(html).toContain("Last refresh failed: Temporary refresh error");
  });

  it("renders legacy detail as read-only fallback history", () => {
    const detail = buildLegacyDetail();
    const html = renderToStaticMarkup(
      createElement(HubspotPushManagerView, {
        catalogHref: "/database?tab=runs",
        detailState: {
          requestState: "ready",
          data: { kind: "legacy", batch: detail },
          error: null,
        },
        historyState: {
          status: "ready",
          items: [
            {
              kind: "legacy",
              summary: buildLegacySummary({
                id: detail.id,
              }),
            },
          ],
          error: null,
        },
        isRefreshingDetail: false,
        isRefreshingHistory: false,
        onReloadHistory: vi.fn(),
        onRetryDetail: vi.fn(),
        onRetryHistory: vi.fn(),
        onSelectBatch: vi.fn(),
        selectedBatchId: detail.id,
      }),
    );

    expect(html).toContain("Legacy Week 6 push");
    expect(html).toContain("Legacy detail");
    expect(html).toContain("hubspot-contact-1");
    expect(html).toContain("Channel has no contact email");
  });
});

describe("hubspot push manager helpers", () => {
  it("formats hubspot batch and row status labels", () => {
    expect(formatHubspotPushStatusLabel("queued")).toBe("Queued");
    expect(formatHubspotPushStatusLabel("failed")).toBe("Failed");
    expect(formatHubspotPushStatusLabel("prepared")).toBe("Prepared");
  });

  it("polls only queued or running list and detail states", () => {
    expect(
      shouldPollHubspotPushHistory([{ summary: buildImportSummary({ status: "completed" }) }]),
    ).toBe(false);
    expect(
      shouldPollHubspotPushHistory([{ summary: buildLegacySummary({ status: "running" }) }]),
    ).toBe(true);
    expect(
      shouldPollHubspotPushDetail({ kind: "import", batch: buildImportDetail({ status: "failed" }) }),
    ).toBe(false);
    expect(
      shouldPollHubspotPushDetail({ kind: "legacy", batch: buildLegacyDetail({ status: "queued" }) }),
    ).toBe(true);
  });

  it("builds workspace hrefs with or without a batch id", () => {
    expect(buildHubspotPushWorkspaceHref("/hubspot", null)).toBe("/hubspot");
    expect(
      buildHubspotPushWorkspaceHref("/hubspot", "fdd240f2-ef31-43fe-b1d2-a584951654a8"),
    ).toBe("/hubspot?batchId=fdd240f2-ef31-43fe-b1d2-a584951654a8");
  });
});
