import type {
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

function buildSummary(overrides?: Partial<HubspotPushBatchSummary>): HubspotPushBatchSummary {
  return {
    id: "fdd240f2-ef31-43fe-b1d2-a584951654a8",
    status: "queued",
    totalRowCount: 2,
    pushedRowCount: 0,
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

function buildDetail(overrides?: Partial<HubspotPushBatchDetail>): HubspotPushBatchDetail {
  return {
    ...buildSummary({
      status: "completed",
      pushedRowCount: 1,
      failedRowCount: 1,
      completedAt: "2026-03-13T09:02:00.000Z",
      ...overrides,
    }),
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
        createdAt: "2026-03-13T09:00:00.000Z",
        updatedAt: "2026-03-13T09:01:00.000Z",
      },
      {
        id: "7399dc95-9ab0-4526-abfa-5da78000b3ab",
        channelId: "f3d0fbec-f8a0-40ad-8e19-2370c6b99083",
        contactEmail: null,
        status: "failed",
        hubspotObjectId: null,
        errorMessage: "Channel has no contact email",
        createdAt: "2026-03-13T09:00:00.000Z",
        updatedAt: "2026-03-13T09:01:00.000Z",
      },
    ],
  };
}

describe("hubspot push manager view", () => {
  it("renders loading history and idle detail states", () => {
    const html = renderToStaticMarkup(
      createElement(HubspotPushManagerView, {
        catalogHref: "/catalog",
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

    expect(html).toContain("HubSpot push batches");
    expect(html).toContain("Loading HubSpot push history...");
    expect(html).toContain("Select a HubSpot batch");
    expect(html).toContain('href="/catalog"');
  });

  it("renders the empty history state with a catalog link", () => {
    const html = renderToStaticMarkup(
      createElement(HubspotPushManagerView, {
        catalogHref: "/catalog",
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

    expect(html).toContain("No HubSpot push history yet");
    expect(html).toContain("Open catalog to start a push");
    expect(html).toContain('href="/catalog"');
  });

  it("renders selected batch detail, completed rows, and failed rows", () => {
    const detail = buildDetail();
    const html = renderToStaticMarkup(
      createElement(HubspotPushManagerView, {
        catalogHref: "/catalog",
        detailState: {
          requestState: "ready",
          data: detail,
          error: "Temporary refresh error",
        },
        historyState: {
          status: "ready",
          items: [
            buildSummary({
              id: detail.id,
              status: "completed",
              pushedRowCount: 1,
              failedRowCount: 1,
              completedAt: "2026-03-13T09:02:00.000Z",
            }),
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

    expect(html).toContain("Refreshing HubSpot push history...");
    expect(html).toContain("Refreshing selected batch...");
    expect(html).toContain("hubspot-push__list-item hubspot-push__list-item--selected");
    expect(html).toContain("Batch summary");
    expect(html).toContain("hubspot-contact-1");
    expect(html).toContain("Channel has no contact email");
    expect(html).toContain("Last refresh failed: History refresh failed");
    expect(html).toContain("Last refresh failed: Temporary refresh error");
  });
});

describe("hubspot push manager helpers", () => {
  it("formats hubspot batch and row status labels", () => {
    expect(formatHubspotPushStatusLabel("queued")).toBe("Queued");
    expect(formatHubspotPushStatusLabel("failed")).toBe("Failed");
    expect(formatHubspotPushStatusLabel("pending")).toBe("Pending");
  });

  it("polls only queued or running list and detail states", () => {
    expect(
      shouldPollHubspotPushHistory([buildSummary({ status: "completed" })]),
    ).toBe(false);
    expect(shouldPollHubspotPushHistory([buildSummary({ status: "running" })])).toBe(true);
    expect(shouldPollHubspotPushDetail(buildDetail({ status: "failed" }))).toBe(false);
    expect(shouldPollHubspotPushDetail(buildDetail({ status: "queued" }))).toBe(true);
  });

  it("builds workspace hrefs with or without a batch id", () => {
    expect(buildHubspotPushWorkspaceHref("/hubspot", null)).toBe("/hubspot");
    expect(
      buildHubspotPushWorkspaceHref("/hubspot", "fdd240f2-ef31-43fe-b1d2-a584951654a8"),
    ).toBe("/hubspot?batchId=fdd240f2-ef31-43fe-b1d2-a584951654a8");
  });
});
