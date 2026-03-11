import { afterEach, describe, expect, it, vi } from "vitest";

import { HubspotError, upsertHubspotContact } from "./contacts";

describe("upsertHubspotContact", () => {
  afterEach(() => {
    delete process.env.HUBSPOT_API_KEY;
  });

  it("requires HUBSPOT_API_KEY", async () => {
    await expect(
      upsertHubspotContact({
        email: "creator@example.com",
        properties: {
          creator_title: "Creator",
        },
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_API_KEY_MISSING",
    } satisfies Partial<HubspotError>);
  });

  it("returns the normalized HubSpot contact id", async () => {
    const fetchFn = vi.fn(async () =>
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
        creator_title: "Creator",
      },
      fetchFn,
    });

    expect(result.id).toBe("201");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("normalizes auth failures", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 }));

    await expect(
      upsertHubspotContact({
        apiKey: "hubspot-key",
        email: "creator@example.com",
        properties: {
          creator_title: "Creator",
        },
        fetchFn,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_AUTH_FAILED",
      status: 401,
    } satisfies Partial<HubspotError>);
  });
});
