import { beforeEach, describe, expect, it, vi } from "vitest";

const { batchReadMock, fetchAssociationsMock, prismaMock } = vi.hoisted(() => ({
  batchReadMock: vi.fn(),
  fetchAssociationsMock: vi.fn(),
  prismaMock: {
    hubspotContactLink: { findMany: vi.fn() },
  },
}));

vi.mock("@scouting-platform/integrations", () => ({
  batchReadHubspotObjects: batchReadMock,
  fetchHubspotAssociations: fetchAssociationsMock,
}));
vi.mock("@scouting-platform/db", () => ({ prisma: prismaMock }));

import { loadHubspotCollaborationSnapshot } from "./collaboration-sync";

const config = {
  contactWorkedWithProperty: "worked_with",
  clientObjectType: "2-198744797",
  campaignObjectType: "2-196889646",
  activationObjectType: "2-200856187",
  activationNameProperty: "activation_name",
  activationTypeProperty: "activation_type",
  activationUrlProperty: "activation_url",
  activationPublicationDateProperty: "publication_date",
} as const;

describe("HubSpot collaboration snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.hubspotContactLink.findMany.mockResolvedValue([
      { id: "link-1", hubspotObjectId: "contact-1" },
      { id: "link-2", hubspotObjectId: "contact-2" },
    ]);
    fetchAssociationsMock.mockImplementation(async (input: {
      fromObjectType: string;
      toObjectType: string;
    }) => {
      if (input.fromObjectType === "contacts") {
        return new Map([
          ["contact-1", ["deal-1"]],
          ["contact-2", ["deal-1"]],
        ]);
      }
      if (input.toObjectType === config.clientObjectType) {
        return new Map([["deal-1", ["client-1"]]]);
      }
      if (input.toObjectType === config.campaignObjectType) {
        return new Map([["deal-1", ["campaign-1"]]]);
      }
      return new Map([["deal-1", ["activation-1"]]]);
    });
    batchReadMock.mockImplementation(async (input: { objectType: string }) => {
      if (input.objectType === "contacts") {
        return [
          { id: "contact-1", properties: { worked_with: "true" }, archived: false },
          { id: "contact-2", properties: { worked_with: "false" }, archived: false },
        ];
      }
      if (input.objectType === "deals") {
        return [{
          id: "deal-1",
          properties: { dealname: "Portal-created deal", dealstage: "contractsigned" },
          archived: false,
        }];
      }
      return [{
        id: "activation-1",
        properties: { activation_name: "Creator integration" },
        archived: false,
      }];
    });
  });

  it("discovers provider-created deals and deduplicates them across linked contacts", async () => {
    const snapshot = await loadHubspotCollaborationSnapshot({
      hubspotPortalId: "portal-row-1",
      config,
    });

    expect(snapshot.deals.map((deal) => deal.id)).toEqual(["deal-1"]);
    expect(snapshot.contactDealIds.get("contact-1")).toEqual(["deal-1"]);
    expect(snapshot.contactDealIds.get("contact-2")).toEqual(["deal-1"]);
    expect(snapshot.activations.map((activation) => activation.id)).toEqual(["activation-1"]);
    expect(batchReadMock).toHaveBeenCalledWith(expect.objectContaining({
      objectType: "deals",
      recordIds: ["deal-1"],
      properties: expect.arrayContaining(["dealname", "amount", "deal_currency_code"]),
    }));
  });
});
