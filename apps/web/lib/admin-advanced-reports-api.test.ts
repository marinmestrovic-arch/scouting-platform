import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminAdvancedReportApiError,
  approveAdminAdvancedReportRequest,
  fetchAdminAdvancedReportRequestDetail,
  fetchAdminAdvancedReportRequests,
  rejectAdminAdvancedReportRequest,
} from "./admin-advanced-reports-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function buildSummaryPayload(overrides?: Record<string, unknown>) {
  return {
    id: "61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d",
    channel: {
      id: "57240497-d52a-4ee8-a4cb-3f1da9f64f3c",
      youtubeChannelId: "UC-APPROVAL-1",
      title: "Approval Queue Channel",
    },
    requestedBy: {
      id: "ee8827ee-53df-4eef-aa7b-67218ef25f91",
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
      requestId: "8efebd15-0d24-4c59-b7e1-71166441c32c",
      completedAt: "2026-02-01T10:00:00.000Z",
      ageDays: 39,
      withinFreshWindow: true,
    },
    ...overrides,
  };
}

function buildDetailPayload(overrides?: Record<string, unknown>) {
  return {
    ...buildSummaryPayload(),
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

describe("admin advanced reports api helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads requests from GET /api/admin/advanced-report-requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [buildSummaryPayload()],
      }),
    );

    const items = await fetchAdminAdvancedReportRequests();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/advanced-report-requests",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(items).toEqual([expect.objectContaining({ status: "pending_approval" })]);
  });

  it("includes the status filter query when requested", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [buildSummaryPayload({ status: "completed" })],
      }),
    );

    await fetchAdminAdvancedReportRequests({ status: "completed" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/advanced-report-requests?status=completed",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("loads request detail from GET /api/admin/advanced-report-requests/:id", async () => {
    const requestId = "61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildDetailPayload()),
    );

    const detail = await fetchAdminAdvancedReportRequestDetail(requestId);

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/admin/advanced-report-requests/${requestId}`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(detail.rawPayload).toEqual({
      report: {
        state: "finished",
      },
    });
  });

  it("approves a request via POST /approve", async () => {
    const requestId = "61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildDetailPayload({ status: "queued", decisionNote: "Approved." })),
    );

    const detail = await approveAdminAdvancedReportRequest(requestId, {
      decisionNote: "Approved.",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/admin/advanced-report-requests/${requestId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          decisionNote: "Approved.",
        }),
      },
    );
    expect(detail.status).toBe("queued");
    expect(detail.decisionNote).toBe("Approved.");
  });

  it("rejects a request via POST /reject", async () => {
    const requestId = "61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildDetailPayload({ status: "rejected", decisionNote: "Not approved." })),
    );

    const detail = await rejectAdminAdvancedReportRequest(requestId, {
      decisionNote: "Not approved.",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/admin/advanced-report-requests/${requestId}/reject`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          decisionNote: "Not approved.",
        }),
      },
    );
    expect(detail.status).toBe("rejected");
    expect(detail.decisionNote).toBe("Not approved.");
  });

  it("surfaces authorization errors from the route layer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(fetchAdminAdvancedReportRequests()).rejects.toThrow(
      "You are not authorized to manage advanced report requests.",
    );
  });

  it("preserves conflict error messages for approve/reject actions", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Only pending approval requests can be approved",
        },
        409,
      ),
    );

    await expect(approveAdminAdvancedReportRequest("61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d")).rejects.toMatchObject({
      message: "Only pending approval requests can be approved",
      status: 409,
    } satisfies Partial<AdminAdvancedReportApiError>);
  });

  it("rejects invalid list responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "missing-shape",
          },
        ],
      }),
    );

    await expect(fetchAdminAdvancedReportRequests()).rejects.toThrow(
      "Received an invalid advanced report list response.",
    );
  });

  it("rejects invalid detail responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: "61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d",
      }),
    );

    await expect(fetchAdminAdvancedReportRequestDetail("61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d")).rejects.toThrow(
      "Received an invalid advanced report detail response.",
    );
  });
});
