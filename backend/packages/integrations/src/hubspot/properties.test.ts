import { afterEach, describe, expect, it, vi } from "vitest";

import { HubspotError } from "./contacts";
import { fetchHubspotPropertyDefinition } from "./properties";

describe("fetchHubspotPropertyDefinition", () => {
  afterEach(() => {
    delete process.env.HUBSPOT_API_KEY;
  });

  it("requires HUBSPOT_API_KEY", async () => {
    await expect(
      fetchHubspotPropertyDefinition({
        objectType: "contacts",
        propertyName: "language",
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_API_KEY_MISSING",
    } satisfies Partial<HubspotError>);
  });

  it("returns a normalized property definition", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          name: "language",
          label: "Language",
          type: "enumeration",
          options: [
            { label: "German", value: "German" },
            { label: "Croatian", value: "Croatian" },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await fetchHubspotPropertyDefinition({
      objectType: "contacts",
      propertyName: "language",
      apiKey: "hubspot-key",
      fetchFn,
    });

    expect(result.name).toBe("language");
    expect(result.options.map((option) => option.label)).toEqual(["German", "Croatian"]);
  });

  it("normalizes provider failures", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 }));

    await expect(
      fetchHubspotPropertyDefinition({
        objectType: "contacts",
        propertyName: "language",
        apiKey: "hubspot-key",
        fetchFn,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_AUTH_FAILED",
      status: 401,
    } satisfies Partial<HubspotError>);
  });

  it("rejects invalid property payloads", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ invalid: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      fetchHubspotPropertyDefinition({
        objectType: "contacts",
        propertyName: "language",
        apiKey: "hubspot-key",
        fetchFn,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_INVALID_RESPONSE",
      status: 502,
    } satisfies Partial<HubspotError>);
  });
});
