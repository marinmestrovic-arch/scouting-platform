import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HubspotError, upsertHubspotContact } from "./contacts";

describe("upsertHubspotContact", () => {
  beforeEach(() => {
    delete process.env.HUBSPOT_API_KEY;
    delete process.env.HUBSPOT_ACCESS_TOKEN;
  });

  afterEach(() => {
    delete process.env.HUBSPOT_API_KEY;
    delete process.env.HUBSPOT_ACCESS_TOKEN;
  });

  it("requires HUBSPOT_API_KEY", async () => {
    await expect(
      upsertHubspotContact({
        email: "creator@example.com",
        properties: {
          youtube_url: "https://youtube.com/@creator",
        },
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_API_KEY_MISSING",
    } satisfies Partial<HubspotError>);
  });

  it("returns the normalized HubSpot contact id", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "201",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await upsertHubspotContact({
      apiKey: "hubspot-key",
      email: "creator@example.com",
      properties: {
        youtube_url: "https://youtube.com/@creator",
        language: "",
      },
      fetchFn,
    });

    expect(result.id).toBe("201");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(url)).toContain(
      "/crm/objects/2026-03/contacts/creator%40example.com?idProperty=email",
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ authorization: "Bearer hubspot-key" }),
      }),
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      properties: { youtube_url: "https://youtube.com/@creator" },
    });
  });

  it("normalizes auth failures", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 }));

    await expect(
      upsertHubspotContact({
        apiKey: "hubspot-key",
        email: "creator@example.com",
        properties: {
          youtube_url: "https://youtube.com/@creator",
        },
        fetchFn,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_AUTH_FAILED",
      status: 401,
    } satisfies Partial<HubspotError>);
  });
});
