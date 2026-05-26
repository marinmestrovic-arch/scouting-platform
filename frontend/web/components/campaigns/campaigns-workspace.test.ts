import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CampaignsWorkspace } from "./campaigns-workspace";

vi.mock("../ui/searchable-select", () => ({
  SearchableSelect: () => null,
}));

describe("CampaignsWorkspace", () => {
  it("renders HubSpot sync metadata", () => {
    const html = renderToStaticMarkup(
      createElement(CampaignsWorkspace, {
        initialData: {
          items: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              name: "Local Campaign",
              client: {
                id: "22222222-2222-4222-8222-222222222222",
                name: "Client A",
                domain: null,
                countryRegion: "Croatia",
                city: "Zagreb",
                isActive: true,
                hubspotObjectId: "101",
                hubspotObjectType: "2-CLIENT",
                hubspotArchived: false,
                hubspotSyncedAt: "2026-04-22T10:00:00.000Z",
              },
              market: null,
              briefLink: "https://example.com/local-brief",
              month: "april",
              year: 2026,
              isActive: true,
              hubspotObjectId: null,
              hubspotObjectType: null,
              hubspotArchived: false,
              hubspotSyncedAt: null,
              createdAt: "2026-04-22T09:00:00.000Z",
              updatedAt: "2026-04-22T10:00:00.000Z",
            },
            {
              id: "44444444-4444-4444-8444-444444444444",
              name: "Active Launch",
              client: {
                id: "22222222-2222-4222-8222-222222222222",
                name: "Client A",
                domain: null,
                countryRegion: "Croatia",
                city: "Zagreb",
                isActive: true,
                hubspotObjectId: "101",
                hubspotObjectType: "2-CLIENT",
                hubspotArchived: false,
                hubspotSyncedAt: "2026-04-22T10:00:00.000Z",
              },
              market: {
                id: "33333333-3333-4333-8333-333333333333",
                name: "Croatia",
              },
              briefLink: null,
              month: "april",
              year: 2026,
              isActive: true,
              hubspotObjectId: "202",
              hubspotObjectType: "2-CAMPAIGN",
              hubspotArchived: false,
              hubspotSyncedAt: "2026-04-22T10:00:00.000Z",
              createdAt: "2026-04-22T09:00:00.000Z",
              updatedAt: "2026-04-22T10:00:00.000Z",
            },
            {
              id: "11111111-1111-4111-8111-111111111111",
              name: "Archived Launch",
              client: {
                id: "22222222-2222-4222-8222-222222222222",
                name: "Client A",
                domain: null,
                countryRegion: "Croatia",
                city: "Zagreb",
                isActive: true,
                hubspotObjectId: "101",
                hubspotObjectType: "2-CLIENT",
                hubspotArchived: false,
                hubspotSyncedAt: "2026-04-22T10:00:00.000Z",
              },
              market: {
                id: "33333333-3333-4333-8333-333333333333",
                name: "Croatia",
              },
              briefLink: null,
              month: "april",
              year: 2026,
              isActive: false,
              hubspotObjectId: "201",
              hubspotObjectType: "2-CAMPAIGN",
              hubspotArchived: true,
              hubspotSyncedAt: "2026-04-22T10:00:00.000Z",
              createdAt: "2026-04-22T09:00:00.000Z",
              updatedAt: "2026-04-22T10:00:00.000Z",
            },
          ],
          filterOptions: {
            clients: [],
            markets: [],
          },
          permissions: {
            canCreate: true,
            role: "admin",
            userType: "admin",
          },
        },
      }),
    );

    expect(html).toContain("HubSpot");
    expect(html).toContain("Markets");
    expect(html).toContain("Brief Link");
    expect(html).toContain('href="https://example.com/local-brief"');
    expect(html).toContain("Open brief");
    expect(html).toContain("Local Campaign");
    expect(html).toContain(">Delete</button>");
    expect(html).toContain("Active Launch");
    expect(html).not.toContain("Archived Launch");
    expect(html).toContain("Archived");
    expect(html).toContain("Synced");
  });
});
