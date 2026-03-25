import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchAdminDashboard } from "./admin-dashboard-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function buildDashboardPayload() {
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
          lastCompletedReport: null,
        },
      ],
    },
    imports: {
      counts: {
        queued: 1,
        running: 0,
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
          userType: "campaign_manager",
          isActive: true,
          youtubeKeyAssigned: false,
          createdAt: "2026-03-10T09:00:00.000Z",
          updatedAt: "2026-03-10T09:00:00.000Z",
        },
      ],
    },
  };
}

describe("admin dashboard api helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the admin dashboard from GET /api/admin/dashboard", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(buildDashboardPayload()));

    const dashboard = await fetchAdminDashboard();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/dashboard",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(dashboard.approvals.counts.pendingApproval).toBe(2);
    expect(dashboard.users.missingYoutubeKeyPreview[0]?.email).toBe("missing-key@example.com");
  });

  it("throws authorization errors for forbidden dashboard access", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(fetchAdminDashboard()).rejects.toThrow(
      "You are not authorized to view the admin dashboard.",
    );
  });

  it("throws when the dashboard response shape is invalid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        generatedAt: "2026-03-12T09:30:00.000Z",
      }),
    );

    await expect(fetchAdminDashboard()).rejects.toThrow(
      "Received an invalid admin dashboard response.",
    );
  });
});
