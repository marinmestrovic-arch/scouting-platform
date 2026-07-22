import { describe, expect, it, vi } from "vitest";

import {
  createHubspotAssociations,
  fetchHubspotAssociationLabels,
  findHubspotAssociationLabel,
} from "./associations";

describe("HubSpot association adapters", () => {
  it("discovers directional labels without treating labels as IDs", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { category: "HUBSPOT_DEFINED", typeId: 3, label: null },
            { category: "USER_DEFINED", typeId: 91, label: "Activation campaign" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const labels = await fetchHubspotAssociationLabels({
      apiKey: "token",
      fetchFn,
      fromObjectType: "deals",
      toObjectType: "2-200856187",
    });

    expect(findHubspotAssociationLabel(labels, "Activation campaign", "USER_DEFINED")).toEqual({
      category: "USER_DEFINED",
      typeId: 91,
      label: "Activation campaign",
    });
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain(
      "/crm/associations/2026-03/deals/2-200856187/labels",
    );
  });

  it("chunks association creation at 2000 inputs", async () => {
    const chunkSizes: number[] = [];
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        inputs: Array<{ from: { id: string }; to: { id: string } }>;
      };
      chunkSizes.push(body.inputs.length);
      return new Response(JSON.stringify({
        status: "COMPLETE",
        results: body.inputs.map((association) => ({
          fromObjectId: association.from.id,
          fromObjectTypeId: "0-1",
          labels: [],
          toObjectId: association.to.id,
          toObjectTypeId: "0-3",
        })),
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await createHubspotAssociations({
      apiKey: "token",
      fetchFn,
      fromObjectType: "contacts",
      toObjectType: "deals",
      associations: Array.from({ length: 2001 }, (_, index) => ({
        fromId: `contact-${index}`,
        toId: "deal-1",
        associationCategory: "HUBSPOT_DEFINED" as const,
        associationTypeId: 4,
      })),
    });

    expect(chunkSizes).toEqual([2000, 1]);
    expect(result.submitted).toBe(2001);
    expect(result.accepted).toBe(2001);
    expect(result.errors).toEqual([]);
    expect(result.outcomes).toHaveLength(2001);
  });

  it("does not hide provider-reported association errors without details", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ status: "COMPLETE", results: [], numErrors: 1, errors: [] }),
        { status: 207, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await createHubspotAssociations({
      accessToken: "token",
      fetchFn,
      fromObjectType: "contacts",
      toObjectType: "deals",
      associations: [{
        fromId: "contact-1",
        toId: "deal-1",
        associationCategory: "HUBSPOT_DEFINED",
        associationTypeId: 4,
      }],
    });

    expect(result.accepted).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({ inputIndex: 0, code: "ASSOCIATION_NOT_CONFIRMED" }),
    ]);
  });

  it("maps a multi-status response to the exact failed association", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        status: "COMPLETE",
        results: [{
          fromObjectId: "contact-1",
          fromObjectTypeId: "0-1",
          labels: [],
          toObjectId: "deal-1",
          toObjectTypeId: "0-3",
        }],
        numErrors: 1,
        errors: [{
          category: "VALIDATION_ERROR",
          message: "Second association is invalid",
          context: {
            fromObjectId: ["contact-2"],
            toObjectId: ["deal-1"],
          },
        }],
      }), { status: 207, headers: { "content-type": "application/json" } }),
    );

    const result = await createHubspotAssociations({
      accessToken: "token",
      fetchFn,
      fromObjectType: "contacts",
      toObjectType: "deals",
      associations: ["contact-1", "contact-2"].map((fromId) => ({
        fromId,
        toId: "deal-1",
        associationCategory: "HUBSPOT_DEFINED" as const,
        associationTypeId: 4,
      })),
    });

    expect(result.accepted).toBe(1);
    expect(result.outcomes).toEqual([
      expect.objectContaining({ inputIndex: 0, success: true }),
      expect.objectContaining({
        inputIndex: 1,
        success: false,
        error: expect.objectContaining({ message: "Second association is invalid" }),
      }),
    ]);
  });

  it("preserves existing labels when adding an association type", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/batch/read")) {
        return new Response(JSON.stringify({
          results: [{
            from: { id: "contact-1" },
            to: [{
              toObjectId: "deal-1",
              associationTypes: [{ typeId: 91, category: "USER_DEFINED", label: "Manual" }],
            }],
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body)) as {
        inputs: Array<{ types: unknown[] }>;
      };
      expect(body.inputs[0]?.types).toEqual([
        { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 4 },
        { associationCategory: "USER_DEFINED", associationTypeId: 91 },
      ]);
      return new Response(JSON.stringify({
        status: "COMPLETE",
        results: [{
          fromObjectId: "contact-1",
          fromObjectTypeId: "0-1",
          labels: ["Manual"],
          toObjectId: "deal-1",
          toObjectTypeId: "0-3",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await createHubspotAssociations({
      accessToken: "token",
      fetchFn,
      fromObjectType: "contacts",
      toObjectType: "deals",
      preserveExistingLabels: true,
      associations: [{
        fromId: "contact-1",
        toId: "deal-1",
        associationCategory: "HUBSPOT_DEFINED",
        associationTypeId: 4,
      }],
    });

    expect(result.accepted).toBe(1);
  });

  it("rejects a successful response that omits association results", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "COMPLETE" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(createHubspotAssociations({
      accessToken: "token",
      fetchFn,
      fromObjectType: "contacts",
      toObjectType: "deals",
      associations: [{
        fromId: "contact-1",
        toId: "deal-1",
        associationCategory: "HUBSPOT_DEFINED",
        associationTypeId: 4,
      }],
    })).rejects.toMatchObject({ code: "HUBSPOT_INVALID_RESPONSE" });
  });
});
