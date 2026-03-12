import type { AdminDashboardResponse } from "@scouting-platform/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: "a",
}));

import { AdminDashboardShellView, shouldPollAdminDashboard } from "./admin-dashboard-shell";

function buildDashboard(overrides?: Partial<AdminDashboardResponse>): AdminDashboardResponse {
  return {
    generatedAt: "2026-03-12T09:30:00.000Z",
    approvals: {
      counts: {
        pendingApproval: 2,
        approved: 1,
        queued: 1,
        running: 0,
        failed: 1,
      },
      pendingPreview: [
        {
          id: "0f35ccde-a640-4ea3-bbc7-b8f66fe45f16",
          channel: {
            id: "f4a36b72-647d-4b2d-8c29-b6990e2f9b6e",
            youtubeChannelId: "UC-DASH-1",
            title: "Pending Channel",
          },
          requestedBy: {
            id: "2e8cfd6c-a624-4130-8a16-1ce6e5d4b4d9",
            email: "manager@example.com",
            name: "Manager",
          },
          reviewedBy: null,
          status: "pending_approval",
          decisionNote: null,
          lastError: null,
          createdAt: "2026-03-11T09:00:00.000Z",
          updatedAt: "2026-03-11T09:00:00.000Z",
          reviewedAt: null,
          startedAt: null,
          completedAt: null,
          lastCompletedReport: {
            requestId: "45111ed1-e807-45da-b8f4-880a13d56318",
            completedAt: "2026-02-27T09:00:00.000Z",
            ageDays: 14,
            withinFreshWindow: true,
          },
        },
      ],
    },
    imports: {
      counts: {
        queued: 1,
        running: 1,
        failed: 1,
      },
      attentionPreview: [
        {
          id: "33e01faf-847b-425e-a354-cb8d24708d1a",
          fileName: "contacts.csv",
          templateVersion: "v1",
          status: "failed",
          totalRowCount: 8,
          importedRowCount: 6,
          failedRowCount: 2,
          lastError: "Upload failed",
          requestedBy: {
            id: "09c3082d-b21d-4e2a-814d-f5d6b97a4dd0",
            email: "admin@example.com",
            name: "Admin",
          },
          createdAt: "2026-03-12T08:00:00.000Z",
          updatedAt: "2026-03-12T08:30:00.000Z",
          startedAt: "2026-03-12T08:05:00.000Z",
          completedAt: null,
        },
      ],
    },
    users: {
      totalCount: 4,
      activeCount: 3,
      adminCount: 1,
      missingYoutubeKeyCount: 1,
      missingYoutubeKeyPreview: [
        {
          id: "ac497cfd-79e4-440f-a489-b938e98e5b9d",
          email: "missing-key@example.com",
          name: "Missing Key",
          role: "user",
          isActive: true,
          youtubeKeyAssigned: false,
          createdAt: "2026-03-10T09:00:00.000Z",
          updatedAt: "2026-03-10T09:00:00.000Z",
        },
      ],
    },
    ...overrides,
  };
}

describe("admin dashboard shell view", () => {
  it("renders the loading state", () => {
    const html = renderToStaticMarkup(
      createElement(AdminDashboardShellView, {
        dashboardState: { status: "loading", data: null, error: null },
        isRefreshing: false,
        onReload: vi.fn(),
        onRetry: vi.fn(),
      }),
    );

    expect(html).toContain("Operations overview");
    expect(html).toContain("Loading admin dashboard...");
    expect(html).toContain('href="/admin/imports"');
    expect(html).toContain('href="/admin/users"');
  });

  it("renders overview cards and preview panels when ready", () => {
    const html = renderToStaticMarkup(
      createElement(AdminDashboardShellView, {
        dashboardState: { status: "ready", data: buildDashboard(), error: null },
        isRefreshing: true,
        onReload: vi.fn(),
        onRetry: vi.fn(),
      }),
    );

    expect(html).toContain("Pending approvals");
    expect(html).toContain("Active HypeAuditor work");
    expect(html).toContain("Actionable CSV imports");
    expect(html).toContain("Managers missing YouTube keys");
    expect(html).toContain("Pending Channel");
    expect(html).toContain("contacts.csv");
    expect(html).toContain("Missing Key");
    expect(html).toContain("Refreshing overview...");
    expect(html).toContain('href="#admin-approval-queue"');
  });

  it("renders error feedback", () => {
    const html = renderToStaticMarkup(
      createElement(AdminDashboardShellView, {
        dashboardState: {
          status: "error",
          data: null,
          error: "Unable to load the admin dashboard.",
        },
        isRefreshing: false,
        onReload: vi.fn(),
        onRetry: vi.fn(),
      }),
    );

    expect(html).toContain("Unable to load the admin dashboard.");
    expect(html).toContain("Retry overview");
  });
});

describe("admin dashboard helpers", () => {
  it("polls only while approvals or imports are actively moving", () => {
    expect(shouldPollAdminDashboard(buildDashboard())).toBe(true);
    expect(
      shouldPollAdminDashboard(
        buildDashboard({
          approvals: {
            counts: {
              pendingApproval: 0,
              approved: 0,
              queued: 0,
              running: 0,
              failed: 1,
            },
            pendingPreview: [],
          },
          imports: {
            counts: {
              queued: 0,
              running: 0,
              failed: 1,
            },
            attentionPreview: [],
          },
        }),
      ),
    ).toBe(false);
  });
});
