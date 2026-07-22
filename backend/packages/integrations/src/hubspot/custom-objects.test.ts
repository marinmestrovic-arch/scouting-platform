import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HubspotError } from "./contacts";
import {
  fetchHubspotAssociations,
  fetchHubspotCustomObjects,
  fetchHubspotObjectSchemas,
} from "./custom-objects";

describe("fetchHubspotObjectSchemas", () => {
  beforeEach(() => {
    delete process.env.HUBSPOT_API_KEY;
    delete process.env.HUBSPOT_ACCESS_TOKEN;
  });

  afterEach(() => {
    delete process.env.HUBSPOT_API_KEY;
    delete process.env.HUBSPOT_ACCESS_TOKEN;
  });

  it("requires HUBSPOT_API_KEY", async () => {
    await expect(fetchHubspotObjectSchemas()).rejects.toMatchObject({
      code: "HUBSPOT_API_KEY_MISSING",
    } satisfies Partial<HubspotError>);
  });

  it("returns normalized custom object schemas", async () => {
    const fetchFn = vi.fn(async (url: unknown) => {
      void url;

      return new Response(
        JSON.stringify({
          results: [
            {
              objectTypeId: "2-123",
              fullyQualifiedName: "p123_clients",
              name: "clients",
              labels: {
                singular: "Client",
                plural: "Clients",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const result = await fetchHubspotObjectSchemas({
      apiKey: "hubspot-key",
      fetchFn,
    });

    expect(result[0]).toMatchObject({
      objectTypeId: "2-123",
      fullyQualifiedName: "p123_clients",
    });
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain(
      "/crm-object-schemas/2026-03/schemas",
    );
  });

  it("rejects a successful schema response without results", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "COMPLETE" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      fetchHubspotObjectSchemas({ apiKey: "hubspot-key", fetchFn }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_INVALID_RESPONSE",
      status: 502,
    } satisfies Partial<HubspotError>);
  });
});

describe("fetchHubspotCustomObjects", () => {
  it("fetches one custom object page with selected properties", async () => {
    const fetchFn = vi.fn(async (url: unknown) => {
      void url;

      return new Response(
        JSON.stringify({
          results: [
            {
              id: "101",
              properties: {
                client_name: "Client A",
              },
              archived: false,
            },
          ],
          paging: {
            next: {
              after: "102",
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const result = await fetchHubspotCustomObjects({
      apiKey: "hubspot-key",
      objectType: "2-123",
      properties: ["client_name", "domain"],
      fetchFn,
    });

    expect(result.results[0]?.id).toBe("101");
    expect(result.nextAfter).toBe("102");
    const url = String(fetchFn.mock.calls[0]?.[0]);
    expect(url).toContain("/crm/objects/2026-03/2-123");
    expect(url).toContain("properties=client_name%2Cdomain");
    expect(url).toContain("archived=false");
  });

  it("normalizes provider failures", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 429 }));

    await expect(
      fetchHubspotCustomObjects({
        apiKey: "hubspot-key",
        objectType: "2-123",
        fetchFn,
        maxRetries: 0,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_RATE_LIMITED",
      status: 429,
    } satisfies Partial<HubspotError>);
  });
});

describe("fetchHubspotAssociations", () => {
  it("returns associated object ids and filters by association type when provided", async () => {
    const fetchFn = vi.fn(async (url: unknown) => {
      void url;

      return new Response(
        JSON.stringify({
          results: [
            {
              from: { id: "campaign-1" },
              to: [
                { toObjectId: 201, associationTypes: [{ typeId: 77 }] },
                { toObjectId: 202, associationTypes: [{ typeId: 88 }] },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const result = await fetchHubspotAssociations({
      apiKey: "hubspot-key",
      fromObjectType: "2-200",
      toObjectType: "2-100",
      objectIds: ["campaign-1"],
      associationTypeId: 77,
      fetchFn,
    });

    expect(result.get("campaign-1")).toEqual(["201"]);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain(
      "/crm/associations/2026-03/2-200/2-100/batch/read",
    );
  });

  it("rejects a successful association response without results", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "COMPLETE" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      fetchHubspotAssociations({
        apiKey: "hubspot-key",
        fromObjectType: "2-200",
        toObjectType: "2-100",
        objectIds: ["campaign-1"],
        fetchFn,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_INVALID_RESPONSE",
      status: 502,
    } satisfies Partial<HubspotError>);
  });
});
