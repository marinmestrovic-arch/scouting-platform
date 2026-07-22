import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    hubspotContactLink: { findMany: vi.fn() },
    hubspotDealMirror: { findMany: vi.fn() },
    hubspotOwner: { findMany: vi.fn() },
    hubspotPipeline: { findMany: vi.fn() },
  },
}));

vi.mock("@scouting-platform/db", () => ({ prisma: prismaMock }));

import { getChannelCollaborationHistory } from "./collaboration-history";

describe("channel collaboration history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.hubspotOwner.findMany.mockResolvedValue([]);
    prismaMock.hubspotPipeline.findMany.mockResolvedValue([]);
  });

  it("combines linked contacts into a deal-ID-deduplicated local history", async () => {
    prismaMock.hubspotContactLink.findMany.mockResolvedValue([
      { mirrorProperties: { worked_with: "false" } },
      { mirrorProperties: { worked_with: "true" } },
    ]);
    prismaMock.hubspotDealMirror.findMany.mockResolvedValue([{
      id: "mirror-1",
      hubspotPortalId: "portal-row-1",
      hubspotObjectId: "deal-123",
      dealName: "Creator collaboration",
      amount: "1250",
      currencyCode: "EUR",
      pipelineId: "pipeline-1",
      stageId: "contractsigned",
      ownerId: "owner-1",
      closeDate: new Date("2026-06-30T00:00:00.000Z"),
      hubspotCreatedAt: new Date("2026-06-01T00:00:00.000Z"),
      hubspotPortal: { portalId: "147403025" },
      clientAssociations: [{ client: { name: "FreeCash" } }],
      campaignAssociations: [{ campaign: { name: "Freecash 6-2026" } }],
      activationAssociations: [{
        hubspotActivationMirror: {
          hubspotObjectId: "activation-1",
          name: "Creator integration",
          activationType: "YouTube",
          activationUrl: "https://youtube.com/watch?v=test",
          publicationDate: new Date("2026-06-20T00:00:00.000Z"),
        },
      }],
    }]);
    prismaMock.hubspotOwner.findMany.mockResolvedValue([{
      hubspotPortalId: "portal-row-1",
      hubspotOwnerId: "owner-1",
      displayName: "Jakob Lisec",
      email: "jakob@example.com",
    }]);
    prismaMock.hubspotPipeline.findMany.mockResolvedValue([{
      hubspotPortalId: "portal-row-1",
      hubspotPipelineId: "pipeline-1",
      stages: [{ hubspotStageId: "contractsigned", label: "Contract signed" }],
    }]);

    const result = await getChannelCollaborationHistory("channel-1");

    expect(result.workedWith).toBe(true);
    expect(result.collaborations).toHaveLength(1);
    expect(result.collaborations[0]).toMatchObject({
      hubspotDealId: "deal-123",
      dealName: "Creator collaboration",
      clients: ["FreeCash"],
      campaigns: ["Freecash 6-2026"],
      amount: "1250",
      currencyCode: "EUR",
      stage: "Contract signed",
      owner: "Jakob Lisec",
    });
    expect(result.collaborations[0]?.hubspotDealUrl).toContain(
      "/147403025/record/0-3/deal-123",
    );
    expect(prismaMock.hubspotDealMirror.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contactAssociations: {
            some: {
              hubspotContactLink: {
                archived: false,
                channelContact: { channelId: "channel-1" },
              },
            },
          },
        }),
      }),
    );
  });

  it("returns an explicit empty state and unknown Worked with value", async () => {
    prismaMock.hubspotContactLink.findMany.mockResolvedValue([]);
    prismaMock.hubspotDealMirror.findMany.mockResolvedValue([]);

    await expect(getChannelCollaborationHistory("channel-2")).resolves.toEqual({
      workedWith: null,
      collaborations: [],
    });
  });
});
