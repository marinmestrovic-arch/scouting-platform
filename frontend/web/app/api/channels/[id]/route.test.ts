import { beforeEach, describe, expect, it, vi } from "vitest";

const { getChannelByIdMock, requireAuthenticatedSessionMock } = vi.hoisted(() => ({
  getChannelByIdMock: vi.fn(),
  requireAuthenticatedSessionMock: vi.fn(),
}));

vi.mock("@scouting-platform/core", () => ({ getChannelById: getChannelByIdMock }));
vi.mock("../../../../lib/api", () => ({
  cachedJson: (payload: unknown) => Response.json(payload),
  requireAuthenticatedSession: requireAuthenticatedSessionMock,
  toRouteErrorResponse: (error: unknown) => Response.json(
    { error: error instanceof Error ? error.message : "error" },
    { status: 500 },
  ),
}));

import { GET } from "./route";

const channelId = "53adac17-f39d-4731-a61f-194150fbc431";

describe("channel detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedSessionMock.mockResolvedValue({ ok: true, userId: "user-1", role: "user" });
    getChannelByIdMock.mockResolvedValue({
      id: channelId,
      youtubeChannelId: "UC123",
      title: "Creator",
      handle: "@creator",
      thumbnailUrl: null,
      description: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      enrichment: {
        status: "missing",
        updatedAt: null,
        completedAt: null,
        lastError: null,
        summary: null,
        topics: null,
        brandFitNotes: null,
        confidence: null,
        structuredProfile: null,
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
      workedWith: true,
      collaborations: [{
        hubspotDealId: "deal-1",
        dealName: "Portal deal",
        hubspotDealUrl: "https://app.hubspot.com/contacts/147403025/record/0-3/deal-1",
        clients: ["Client"],
        campaigns: ["Campaign"],
        amount: "1000",
        currencyCode: "EUR",
        stage: "Contract signed",
        owner: "Owner",
        closeDate: null,
        createdAt: null,
        activations: [],
      }],
    });
  });

  it("returns authenticated local collaboration history", async () => {
    const response = await GET(new Request(`http://localhost/api/channels/${channelId}`), {
      params: Promise.resolve({ id: channelId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workedWith: true,
      collaborations: [{ hubspotDealId: "deal-1", stage: "Contract signed" }],
    });
    expect(getChannelByIdMock).toHaveBeenCalledWith(channelId);
  });

  it("enforces server-side authentication before reading the profile", async () => {
    requireAuthenticatedSessionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET(new Request(`http://localhost/api/channels/${channelId}`), {
      params: Promise.resolve({ id: channelId }),
    });

    expect(response.status).toBe(401);
    expect(getChannelByIdMock).not.toHaveBeenCalled();
  });
});
