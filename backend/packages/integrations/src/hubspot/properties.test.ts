import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HubspotError } from "./contacts";
import {
  fetchHubspotAccountDetails,
  fetchHubspotAccountIdentity,
  fetchHubspotProperties,
  fetchHubspotPropertyDefinition,
  findHubspotPropertyOptionByLabel,
} from "./properties";

describe("fetchHubspotPropertyDefinition", () => {
  beforeEach(() => {
    delete process.env.HUBSPOT_API_KEY;
    delete process.env.HUBSPOT_ACCESS_TOKEN;
  });

  afterEach(() => {
    delete process.env.HUBSPOT_API_KEY;
    delete process.env.HUBSPOT_ACCESS_TOKEN;
  });

  it("rejects partial payloads that omit the options collection", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          name: "language",
          label: "Language",
          type: "enumeration",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      fetchHubspotPropertyDefinition({
        accessToken: "test-token",
        objectType: "contacts",
        propertyName: "language",
        fetchFn: fetchFn as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "HUBSPOT_INVALID_RESPONSE" });
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
          hasUniqueValue: true,
          options: [
            { label: "German", value: "de" },
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
    expect(result.hasUniqueValue).toBe(true);
    expect(findHubspotPropertyOptionByLabel(result, "German")).toEqual(
      expect.objectContaining({ label: "German", value: "de" }),
    );
  });

  it("lists definitions without collapsing display labels into internal values", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              name: "collaboration_type",
              label: "Collaboration Type",
              type: "enumeration",
              hasUniqueValue: false,
              options: [
                { label: "Flat Fee", value: "INFLUENCER_COLLABORATION" },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await fetchHubspotProperties({
      objectType: "deals",
      apiKey: "hubspot-key",
      fetchFn,
    });

    expect(result[0]?.options[0]).toEqual({
      label: "Flat Fee",
      value: "INFLUENCER_COLLABORATION",
    });
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/crm/properties/2026-03/deals");
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

describe("fetchHubspotAccountDetails", () => {
  afterEach(() => {
    delete process.env.HUBSPOT_API_KEY;
    delete process.env.HUBSPOT_ACCESS_TOKEN;
  });

  it("returns portal active currencies", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      void input;

      return new Response(
        JSON.stringify({
          portalId: 12345,
          accountType: "STANDARD",
          timeZone: "Europe/Zagreb",
          companyCurrency: "EUR",
          additionalCurrencies: ["USD"],
          uiDomain: "app.hubspot.com",
          dataHostingLocation: "eu1",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const result = await fetchHubspotAccountDetails({
      apiKey: "hubspot-key",
      fetchFn,
    });

    expect(result.companyCurrency).toBe("EUR");
    expect(result.additionalCurrencies).toEqual(["USD"]);
    expect(result.portalId).toBe("12345");
    expect(result.timeZone).toBe("Europe/Zagreb");
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/account-info/2026-03/details");
  });

  it("requires a portal id for account identity checks", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ companyCurrency: "EUR" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      fetchHubspotAccountIdentity({ apiKey: "hubspot-key", fetchFn }),
    ).rejects.toMatchObject({ code: "HUBSPOT_INVALID_RESPONSE" } satisfies Partial<HubspotError>);
  });

  it("rejects invalid account detail payloads", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ additionalCurrencies: [123] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      fetchHubspotAccountDetails({
        apiKey: "hubspot-key",
        fetchFn,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_INVALID_RESPONSE",
      status: 502,
    } satisfies Partial<HubspotError>);
  });
});
