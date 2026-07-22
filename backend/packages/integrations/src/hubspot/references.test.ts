import { describe, expect, it, vi } from "vitest";

import { HubspotError } from "./client";
import { fetchHubspotOwners, fetchHubspotPipelines } from "./references";

describe("HubSpot reference adapters", () => {
  it("returns owner IDs separately from user IDs", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "owner-10",
              userId: 999,
              email: "owner@example.com",
              archived: false,
              teams: [{ id: "team-1", name: "Sales", primary: true }],
            },
          ],
          paging: { next: { after: "owner-11" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await fetchHubspotOwners({ apiKey: "token", fetchFn });

    expect(result.results[0]).toMatchObject({ id: "owner-10", userId: "999" });
    expect(result.nextAfter).toBe("owner-11");
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/crm/owners/2026-03");
  });

  it("retains internal pipeline and stage IDs", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "default",
              label: "Sales Pipeline",
              stages: [
                {
                  id: "appointmentscheduled",
                  label: "Scouted",
                  displayOrder: 0,
                  metadata: { probability: "0.2" },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await fetchHubspotPipelines({
      apiKey: "token",
      fetchFn,
      objectType: "deals",
    });

    expect(result[0]).toMatchObject({
      id: "default",
      label: "Sales Pipeline",
      stages: [{ id: "appointmentscheduled", label: "Scouted" }],
    });
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/crm/pipelines/2026-03/deals");
  });

  it.each([
    {
      name: "owners",
      execute: (fetchFn: typeof fetch) => fetchHubspotOwners({ apiKey: "token", fetchFn }),
    },
    {
      name: "pipelines",
      execute: (fetchFn: typeof fetch) =>
        fetchHubspotPipelines({
          apiKey: "token",
          fetchFn,
          objectType: "deals",
        }),
    },
  ])("rejects a successful $name response without results", async ({ execute }) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "COMPLETE" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(execute(fetchFn)).rejects.toMatchObject({
      code: "HUBSPOT_INVALID_RESPONSE",
      status: 502,
    } satisfies Partial<HubspotError>);
  });
});
