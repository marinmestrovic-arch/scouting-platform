import type {
  AdminAdvancedReportRequestDetail,
  AdminAdvancedReportRequestSummary,
  AdvancedReportRequestStatus,
} from "@scouting-platform/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: "a",
}));

import {
  AdminAdvancedReportQueueView,
  getAdminAdvancedReportFreshnessCopy,
  getAdminAdvancedReportStatusLabel,
  shouldPollAdminAdvancedReportDetail,
  shouldPollAdminAdvancedReportList,
} from "./admin-advanced-report-queue";

function buildSummary(overrides?: Partial<AdminAdvancedReportRequestSummary>): AdminAdvancedReportRequestSummary {
  return {
    id: "c99a95aa-363f-4a7e-bd38-680251d42ff0",
    channel: {
      id: "75aa14d8-0311-4de6-802d-afeb6e3a49b7",
      youtubeChannelId: "UC-QUEUE-1",
      title: "Queue Channel",
    },
    requestedBy: {
      id: "62a7c45d-a1b7-4bd2-9b0f-36570a27ea28",
      email: "manager@example.com",
      name: "Manager",
    },
    reviewedBy: null,
    status: "pending_approval",
    decisionNote: null,
    lastError: null,
    createdAt: "2026-03-11T09:00:00.000Z",
    updatedAt: "2026-03-11T09:05:00.000Z",
    reviewedAt: null,
    startedAt: null,
    completedAt: null,
    lastCompletedReport: {
      requestId: "d4ddbb49-fbd3-4257-baa4-7b3a6a463693",
      completedAt: "2026-02-28T09:00:00.000Z",
      ageDays: 12,
      withinFreshWindow: true,
    },
    ...overrides,
  };
}

function buildDetail(overrides?: Partial<AdminAdvancedReportRequestDetail>): AdminAdvancedReportRequestDetail {
  return {
    ...buildSummary(),
    insights: {
      audienceCountries: [],
      audienceGenderAge: [],
      audienceInterests: [],
      estimatedPrice: null,
      brandMentions: [],
    },
    rawPayload: {
      report: {
        state: "finished",
      },
    },
    ...overrides,
  };
}

describe("admin advanced report queue view", () => {
  it("renders loading state for the list and empty detail selection", () => {
    const html = renderToStaticMarkup(
      createElement(AdminAdvancedReportQueueView, {
        actionState: { type: "idle", action: null, message: "" },
        decisionNoteDraft: "",
        detailState: { status: "idle", data: null, error: null },
        isRefreshingDetail: false,
        isRefreshingList: false,
        listState: { status: "loading", items: [], error: null },
        onApprove: vi.fn(),
        onDecisionNoteChange: vi.fn(),
        onReject: vi.fn(),
        onReload: vi.fn(),
        onRetryDetail: vi.fn(),
        onRetryList: vi.fn(),
        onSelectRequest: vi.fn(),
        onStatusFilterChange: vi.fn(),
        selectedRequestId: null,
        statusFilter: "pending_approval",
      }),
    );

    expect(html).toContain("Approval queue");
    expect(html).toContain("Loading advanced report requests...");
    expect(html).toContain("Select a request");
    expect(html).toContain('href="/admin/users"');
  });

  it("renders pending requests with decision controls and raw payload detail", () => {
    const detail = buildDetail();
    const html = renderToStaticMarkup(
      createElement(AdminAdvancedReportQueueView, {
        actionState: { type: "success", action: null, message: "Approval recorded." },
        decisionNoteDraft: "Approved for lookup.",
        detailState: { status: "ready", data: detail, error: null },
        isRefreshingDetail: true,
        isRefreshingList: true,
        listState: { status: "ready", items: [buildSummary()], error: null },
        onApprove: vi.fn(),
        onDecisionNoteChange: vi.fn(),
        onReject: vi.fn(),
        onReload: vi.fn(),
        onRetryDetail: vi.fn(),
        onRetryList: vi.fn(),
        onSelectRequest: vi.fn(),
        onStatusFilterChange: vi.fn(),
        selectedRequestId: detail.id,
        statusFilter: "pending_approval",
      }),
    );

    expect(html).toContain("Queue Channel");
    expect(html).toContain("Pending approval");
    expect(html).toContain("Approve request");
    expect(html).toContain("Reject request");
    expect(html).toContain("Refreshing queue...");
    expect(html).toContain("Refreshing selected request...");
    expect(html).toContain("Approved for lookup.");
    expect(html).toContain("Raw provider payload");
    expect(html).toContain("&quot;state&quot;: &quot;finished&quot;");
  });

  it("renders non-pending history rows with empty state copy and recorded notes", () => {
    const detail = buildDetail({
      status: "completed",
      decisionNote: "Previously approved.",
    });
    const html = renderToStaticMarkup(
      createElement(AdminAdvancedReportQueueView, {
        actionState: { type: "idle", action: null, message: "" },
        decisionNoteDraft: "",
        detailState: { status: "ready", data: detail, error: null },
        isRefreshingDetail: false,
        isRefreshingList: false,
        listState: { status: "ready", items: [], error: null },
        onApprove: vi.fn(),
        onDecisionNoteChange: vi.fn(),
        onReject: vi.fn(),
        onReload: vi.fn(),
        onRetryDetail: vi.fn(),
        onRetryList: vi.fn(),
        onSelectRequest: vi.fn(),
        onStatusFilterChange: vi.fn(),
        selectedRequestId: detail.id,
        statusFilter: "completed",
      }),
    );

    expect(html).toContain("No completed requests found.");
    expect(html).not.toContain("Approve request");
    expect(html).toContain("Previously approved.");
  });
});

describe("admin advanced report queue helpers", () => {
  it("formats status labels and freshness copy", () => {
    expect(getAdminAdvancedReportStatusLabel("pending_approval")).toBe("Pending Approval");
    expect(
      getAdminAdvancedReportFreshnessCopy({
        requestId: "d4ddbb49-fbd3-4257-baa4-7b3a6a463693",
        completedAt: "2026-02-28T09:00:00.000Z",
        ageDays: 12,
        withinFreshWindow: true,
      }),
    ).toBe("Last completed report is fresh (12 days old).");
  });

  it("decides which list/detail states should poll", () => {
    expect(
      shouldPollAdminAdvancedReportList({
        statusFilter: "pending_approval",
        items: [],
      }),
    ).toBe(true);
    expect(
      shouldPollAdminAdvancedReportList({
        statusFilter: "completed",
        items: [buildSummary({ status: "completed" }), buildSummary({ status: "queued" })],
      }),
    ).toBe(true);
    expect(
      shouldPollAdminAdvancedReportList({
        statusFilter: "completed",
        items: [buildSummary({ status: "completed" })],
      }),
    ).toBe(false);
    expect(shouldPollAdminAdvancedReportDetail(buildDetail({ status: "running" }))).toBe(true);
    expect(shouldPollAdminAdvancedReportDetail(buildDetail({ status: "completed" }))).toBe(false);
  });
});
