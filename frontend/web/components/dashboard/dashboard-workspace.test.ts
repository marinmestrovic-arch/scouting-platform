import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { replaceMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

import { DashboardWorkspace } from "./dashboard-workspace";

function buildRunMetadata() {
  return {
    campaignId: "campaign-1",
    client: "Sony",
    market: "DACH",
    campaignManagerUserId: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
    campaignManager: {
      id: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
      email: "manager@example.com",
      name: "Manager",
    },
    briefLink: "https://example.com/brief",
    campaignName: "Spring Launch 2026",
    month: "march" as const,
    year: 2026,
    dealOwner: "Marin",
    dealName: "Sony Gaming Q2",
    pipeline: "New business",
    dealStage: "Contract sent",
    currency: "EUR",
    dealType: "Paid social",
    activationType: "YouTube integration",
  };
}

describe("dashboard workspace", () => {
  it("renders the redesigned dashboard header, filters, and data table", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardWorkspace, {
        initialData: {
          items: [
            {
              id: "run-1",
              name: "Gaming run",
              query: "gaming creators",
              target: 20,
              status: "completed",
              lastError: null,
              createdAt: "2026-03-15T12:00:00.000Z",
              updatedAt: "2026-03-15T13:00:00.000Z",
              startedAt: "2026-03-15T12:01:00.000Z",
              completedAt: "2026-03-15T13:00:00.000Z",
              resultCount: 12,
              metadata: buildRunMetadata(),
            },
          ],
          filterOptions: {
            campaignManagers: [buildRunMetadata().campaignManager],
            clients: ["Sony"],
            markets: ["DACH"],
          },
        },
        initialFilters: {
          campaignManagerUserId: "",
          client: "",
          market: "",
        },
      }),
    );

    expect(html).toContain("Dashboard");
    expect(html).toContain("Review recent scouting runs");
    expect(html).toContain("Refresh");
    expect(html).toContain("New run");
    expect(html).toContain("Search runs");
    expect(html).toContain("Campaign Manager");
    expect(html).toContain("Client");
    expect(html).toContain("Market");
    expect(html).toContain(">All<");
    expect(html).toContain(">Running<");
    expect(html).toContain(">Completed<");
    expect(html).toContain(">Failed<");
    expect(html).toContain("Brief Link");
    expect(html).toContain("Influencer List");
    expect(html).toContain("Coverage");
    expect(html).toContain("Status");
    expect(html).toContain("Started");
    expect(html).toContain("Actions");
    expect(html).toContain('href="/runs/run-1"');
    expect(html).toContain(">Gaming run<");
    expect(html).toContain(">Sony<");
    expect(html).toContain(">DACH<");
    expect(html).toContain(">Manager<");
    expect(html).toContain('href="https://example.com/brief"');
    expect(html).toContain("60% coverage · 12/20");
    expect(html).toContain("status-pill--completed");
    expect(html).toContain(">2026-03-15 12:01 UTC<");
    expect(html).toContain("Export");
    expect(html).toContain("Google Sheets");
    expect(html).toContain("All campaign managers");
    expect(html).toContain("All clients");
    expect(html).toContain("All markets");
  });
});
