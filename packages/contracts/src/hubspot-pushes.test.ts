import { describe, expect, it } from "vitest";

import {
  createHubspotPushBatchRequestSchema,
  hubspotPushBatchDetailSchema,
} from "./hubspot-pushes";

describe("hubspot push contracts", () => {
  it("dedicates batch creation to selected channel ids", () => {
    const parsed = createHubspotPushBatchRequestSchema.parse({
      channelIds: ["11111111-1111-4111-8111-111111111111"],
    });

    expect(parsed.channelIds).toHaveLength(1);
  });

  it("validates detail payloads with row results", () => {
    const parsed = hubspotPushBatchDetailSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      status: "completed",
      totalRowCount: 1,
      pushedRowCount: 1,
      failedRowCount: 0,
      lastError: null,
      requestedBy: {
        id: "22222222-2222-4222-8222-222222222222",
        email: "manager@example.com",
        name: "Manager",
      },
      createdAt: "2026-03-11T12:00:00.000Z",
      updatedAt: "2026-03-11T12:00:00.000Z",
      startedAt: "2026-03-11T12:00:05.000Z",
      completedAt: "2026-03-11T12:00:10.000Z",
      scope: {
        channelIds: ["33333333-3333-4333-8333-333333333333"],
      },
      rows: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          channelId: "33333333-3333-4333-8333-333333333333",
          contactEmail: "creator@example.com",
          status: "pushed",
          hubspotObjectId: "hubspot-123",
          errorMessage: null,
          createdAt: "2026-03-11T12:00:00.000Z",
          updatedAt: "2026-03-11T12:00:10.000Z",
        },
      ],
    });

    expect(parsed.rows[0]?.status).toBe("pushed");
  });
});
