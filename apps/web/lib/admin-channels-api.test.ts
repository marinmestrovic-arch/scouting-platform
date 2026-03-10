import { beforeEach, describe, expect, it, vi } from "vitest";

import { patchAdminChannelManualOverrides } from "./admin-channels-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function buildManualOverrideResponse() {
  return {
    channel: {
      id: "53adac17-f39d-4731-a61f-194150fbc431",
      youtubeChannelId: "UC123",
      title: "Manual title",
      handle: "@channelone",
      description: "Space and creator economy coverage.",
      thumbnailUrl: "https://example.com/thumb.jpg",
      createdAt: "2026-03-01T10:00:00.000Z",
      updatedAt: "2026-03-08T10:00:00.000Z",
      enrichment: {
        status: "completed",
        updatedAt: "2026-03-08T10:00:00.000Z",
        completedAt: "2026-03-08T10:00:00.000Z",
        lastError: null,
        summary: "Creator focused on launches and industry analysis.",
        topics: ["space", "launches"],
        brandFitNotes: "Strong fit for launch providers.",
        confidence: 0.82,
      },
      advancedReport: {
        requestId: null,
        status: "missing",
        updatedAt: null,
        completedAt: null,
        lastError: null,
        requestedAt: null,
        reviewedAt: null,
        decisionNote: null,
        lastCompletedReport: null,
      },
      insights: {
        audienceCountries: [],
        audienceGenderAge: [],
        audienceInterests: [],
        estimatedPrice: null,
        brandMentions: [],
      },
    },
    applied: [
      {
        field: "title",
        op: "set",
      },
    ],
  };
}

describe("admin channels api helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("patches channel manual overrides via PATCH /api/admin/channels/:id/manual-overrides", async () => {
    const channelId = "53adac17-f39d-4731-a61f-194150fbc431";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(buildManualOverrideResponse()),
    );

    const response = await patchAdminChannelManualOverrides(channelId, {
      operations: [
        {
          field: "title",
          op: "set",
          value: "Manual title",
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/admin/channels/${channelId}/manual-overrides`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operations: [
            {
              field: "title",
              op: "set",
              value: "Manual title",
            },
          ],
        }),
      },
    );
    expect(response.applied).toEqual([
      {
        field: "title",
        op: "set",
      },
    ]);
    expect(response.channel.title).toBe("Manual title");
  });

  it("surfaces authorization failures for manual edit requests", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(
      patchAdminChannelManualOverrides("53adac17-f39d-4731-a61f-194150fbc431", {
        operations: [
          {
            field: "title",
            op: "set",
            value: "Manual title",
          },
        ],
      }),
    ).rejects.toThrow("You are not authorized to manage manual channel edits.");
  });

  it("throws route error messages for invalid manual override requests", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Title cannot be null",
        },
        400,
      ),
    );

    await expect(
      patchAdminChannelManualOverrides("53adac17-f39d-4731-a61f-194150fbc431", {
        operations: [
          {
            field: "title",
            op: "set",
            value: "Manual title",
          },
        ],
      }),
    ).rejects.toThrow("Title cannot be null");
  });
});
