import { describe, expect, it, vi } from "vitest";

import { HubspotError } from "./client";
import {
  batchReadHubspotObjects,
  batchUpdateHubspotContacts,
  batchUpsertHubspotContacts,
  batchUpsertHubspotDeals,
  batchUpsertHubspotObjects,
  fetchHubspotObjectPage,
  searchHubspotObjectsUpdatedAfter,
} from "./objects";

describe("HubSpot object reads", () => {
  it("uses the current object page API", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ id: "101", properties: { name: "Client" } }],
          paging: { next: { after: "102" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await fetchHubspotObjectPage({
      apiKey: "token",
      fetchFn,
      objectType: "2-123",
      properties: ["name"],
    });

    expect(result.nextAfter).toBe("102");
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/crm/objects/2026-03/2-123");
  });

  it("batch-reads records with explicitly requested properties", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "deal-1",
              properties: { dealname: "Creator campaign" },
              createdAt: "2026-07-20T10:00:00.000Z",
              updatedAt: "2026-07-21T10:00:00.000Z",
              archived: false,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const records = await batchReadHubspotObjects({
      apiKey: "hubspot-key",
      fetchFn,
      objectType: "deals",
      recordIds: ["deal-1"],
      properties: ["dealname", "amount"],
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("deal-1");
    const [, request] = fetchFn.mock.calls[0]!;
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({
      inputs: [{ id: "deal-1" }],
      properties: ["dealname", "amount"],
    });
  });

  it("rejects empty and oversized object-read batches before calling HubSpot", async () => {
    const fetchFn = vi.fn<typeof fetch>();

    await expect(
      batchReadHubspotObjects({
        apiKey: "hubspot-key",
        fetchFn,
        objectType: "deals",
        recordIds: [],
      }),
    ).rejects.toMatchObject({ code: "HUBSPOT_INVALID_INPUT" });
    await expect(
      batchReadHubspotObjects({
        apiKey: "hubspot-key",
        fetchFn,
        objectType: "deals",
        recordIds: Array.from({ length: 101 }, (_, index) => String(index + 1)),
      }),
    ).rejects.toMatchObject({ code: "HUBSPOT_INVALID_INPUT" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("builds an ascending incremental search from a millisecond high-water mark", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await searchHubspotObjectsUpdatedAfter({
      apiKey: "token",
      fetchFn,
      objectType: "contacts",
      updatedAfter: "2026-07-01T00:00:00.000Z",
      properties: ["email"],
    });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(url)).toContain("/crm/objects/2026-03/contacts/search");
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "hs_lastmodifieddate",
                operator: "GTE",
                value: String(Date.parse("2026-07-01T00:00:00.000Z")),
              },
            ],
          },
        ],
        sorts: ["hs_lastmodifieddate"],
      }),
    );
  });

  it("rejects a successful object page response without results", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ paging: { next: { after: "102" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      fetchHubspotObjectPage({
        apiKey: "token",
        fetchFn,
        objectType: "contacts",
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_INVALID_RESPONSE",
      status: 502,
    } satisfies Partial<HubspotError>);
  });
});

describe("batchUpsertHubspotObjects", () => {
  it("chunks deterministically, preserves explicit clears, and omits undefined properties", async () => {
    const submitted: Array<Array<Record<string, unknown>>> = [];
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { inputs: Array<Record<string, unknown>> };
      submitted.push(body.inputs);
      return new Response(
        JSON.stringify({
          status: "COMPLETE",
          results: body.inputs.map((record, index) => ({
            id: `crm-${submitted.length}-${index}`,
            objectWriteTraceId: record.objectWriteTraceId,
            properties: record.properties,
            new: true,
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const records = Array.from({ length: 201 }, (_, index) => ({
      id: `local-${index}`,
      idProperty: "scouting_platform_id",
      properties: {
        email: `creator-${index}@example.com`,
        blank: "",
        nulled: null,
        missing: undefined,
      },
    }));

    const result = await batchUpsertHubspotObjects({
      apiKey: "token",
      fetchFn,
      objectType: "contacts",
      records,
    });

    expect(submitted.map((chunk) => chunk.length)).toEqual([100, 100, 1]);
    expect(submitted[0]?.[0]?.properties).toEqual({
      email: "creator-0@example.com",
      blank: "",
      nulled: null,
    });
    expect(result).toMatchObject({ succeeded: 201, failed: 0 });
    expect(result.outcomes.map((outcome) => outcome.inputIndex)).toEqual(
      Array.from({ length: 201 }, (_, index) => index),
    );
  });

  it("maps 207 success and failure records by objectWriteTraceId", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "COMPLETE",
          numErrors: 1,
          results: [
            {
              id: "hubspot-1",
              objectWriteTraceId: "row-one",
              new: true,
              properties: { email: "one@example.com" },
            },
          ],
          errors: [
            {
              category: "VALIDATION_ERROR",
              message: "Invalid owner",
              context: { objectWriteTraceId: ["row-two"] },
              errors: [{ code: "INVALID_OWNER_ID" }],
            },
          ],
        }),
        { status: 207, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await batchUpsertHubspotObjects({
      apiKey: "token",
      fetchFn,
      objectType: "contacts",
      records: [
        {
          id: "one",
          idProperty: "scouting_platform_id",
          properties: { email: "one@example.com" },
          objectWriteTraceId: "row-one",
        },
        {
          id: "two",
          idProperty: "scouting_platform_id",
          properties: { email: "two@example.com" },
          objectWriteTraceId: "row-two",
        },
      ],
    });

    expect(result).toEqual({
      outcomes: [
        expect.objectContaining({ success: true, id: "hubspot-1", inputIndex: 0 }),
        expect.objectContaining({
          success: false,
          inputIndex: 1,
          code: "INVALID_OWNER_ID",
        }),
      ],
      succeeded: 1,
      failed: 1,
    });
  });

  it("omits unknown legacy creator fields instead of serializing destructive clears", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        inputs: Array<{
          objectWriteTraceId: string;
          properties: Record<string, unknown>;
        }>;
      };
      return new Response(
        JSON.stringify({
          status: "COMPLETE",
          results: body.inputs.map((record) => ({
            id: "hubspot-contact-1",
            objectWriteTraceId: record.objectWriteTraceId,
            properties: record.properties,
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await batchUpsertHubspotContacts({
      apiKey: "token",
      fetchFn,
      allowEmailIdentifierForFullUpsert: true,
      records: [{
        id: "creator@example.com",
        idProperty: "email",
        objectWriteTraceId: "legacy-row",
        properties: {
          email: "creator@example.com",
          youtube_handle: undefined,
          youtube_followers: undefined,
          youtube_video_average_views: undefined,
          youtube_engagement_rate: undefined,
          language: undefined,
        },
      }],
    });

    const request = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)) as {
      inputs: Array<{ properties: Record<string, unknown> }>;
    };
    expect(request.inputs[0]?.properties).toEqual({ email: "creator@example.com" });
  });

  it("rejects a successful batch response without results", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "COMPLETE", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      batchUpsertHubspotObjects({
        apiKey: "token",
        fetchFn,
        objectType: "contacts",
        records: [
          {
            id: "one",
            idProperty: "scouting_platform_id",
            properties: { email: "one@example.com" },
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_INVALID_RESPONSE",
      status: 502,
    } satisfies Partial<HubspotError>);
  });

  it("awaits the first chunk checkpoint before a later transport failure", async () => {
    const lifecycle: string[] = [];
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (fetchFn.mock.calls.length === 2) {
        lifecycle.push("second request");
        throw new TypeError("fetch failed");
      }
      const body = JSON.parse(String(init?.body)) as {
        inputs: Array<{
          objectWriteTraceId: string;
          properties: Record<string, unknown>;
        }>;
      };
      return new Response(
        JSON.stringify({
          status: "COMPLETE",
          results: body.inputs.map((record, index) => ({
            id: `hubspot-${index}`,
            objectWriteTraceId: record.objectWriteTraceId,
            properties: record.properties,
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const onChunkComplete = vi.fn(async () => {
      lifecycle.push("first checkpoint");
    });

    await expect(
      batchUpsertHubspotObjects({
        apiKey: "token",
        fetchFn,
        maxRetries: 0,
        objectType: "contacts",
        records: Array.from({ length: 101 }, (_, index) => ({
          id: `local-${index}`,
          idProperty: "scouting_platform_id",
          properties: { email: `creator-${index}@example.com` },
        })),
        onChunkComplete,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_NETWORK_ERROR",
      status: 502,
    } satisfies Partial<HubspotError>);

    expect(onChunkComplete).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(["first checkpoint", "second request"]);
    expect(onChunkComplete).toHaveBeenCalledWith({
      chunkIndex: 0,
      inputStartIndex: 0,
      inputEndIndexExclusive: 100,
      outcomes: expect.arrayContaining([
        expect.objectContaining({ inputIndex: 0, success: true }),
        expect.objectContaining({ inputIndex: 99, success: true }),
      ]),
      succeeded: 100,
      failed: 0,
    });
  });

  it("requires explicit full-upsert intent for contact email and a custom unique ID for deals", async () => {
    expect(() =>
      batchUpsertHubspotContacts({
        apiKey: "token",
        records: [{ id: "a@example.com", idProperty: "email", properties: { email: "a@example.com" } }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "HUBSPOT_INVALID_INPUT" }) as HubspotError,
    );
    expect(() =>
      batchUpsertHubspotDeals({
        apiKey: "token",
        records: [{ id: "123", idProperty: "hs_object_id", properties: { dealname: "Deal" } }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "HUBSPOT_INVALID_INPUT" }) as HubspotError,
    );
  });

  it("updates legacy contacts by record ID with partial error mapping and omit-not-clear semantics", async () => {
    const submitted: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/crm/objects/2026-03/contacts/batch/update");
      const body = JSON.parse(String(init?.body)) as {
        inputs: Array<Record<string, unknown>>;
      };
      submitted.push(...body.inputs);
      return new Response(
        JSON.stringify({
          status: "COMPLETE",
          numErrors: 1,
          results: [{
            id: "legacy-1",
            objectWriteTraceId: "row-one",
            properties: body.inputs[0]?.properties,
          }],
          errors: [{
            id: "legacy-2",
            category: "VALIDATION_ERROR",
            message: "Invalid contact property",
            errors: [{ code: "PROPERTY_DOESNT_EXIST" }],
          }],
        }),
        { status: 207, headers: { "content-type": "application/json" } },
      );
    });

    const result = await batchUpdateHubspotContacts({
      apiKey: "token",
      fetchFn,
      records: [
        {
          id: "legacy-1",
          objectWriteTraceId: "row-one",
          properties: {
            atlas_contact_id: "contact:one",
            firstname: "Updated",
            explicitClear: "",
            omitted: undefined,
          },
        },
        {
          id: "legacy-2",
          objectWriteTraceId: "row-two",
          properties: { atlas_contact_id: "contact:two" },
        },
      ],
    });

    expect(submitted[0]).toEqual({
      id: "legacy-1",
      objectWriteTraceId: "row-one",
      properties: {
        atlas_contact_id: "contact:one",
        firstname: "Updated",
        explicitClear: "",
      },
    });
    expect(submitted[0]).not.toHaveProperty("idProperty");
    expect(result).toEqual({
      outcomes: [
        expect.objectContaining({ success: true, id: "legacy-1", inputIndex: 0 }),
        expect.objectContaining({
          success: false,
          inputIndex: 1,
          code: "PROPERTY_DOESNT_EXIST",
        }),
      ],
      succeeded: 1,
      failed: 1,
    });
  });
});
