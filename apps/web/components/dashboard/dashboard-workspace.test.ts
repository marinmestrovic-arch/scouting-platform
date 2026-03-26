import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useEffectMock, useRouterMock, useStateMock } = vi.hoisted(() => ({
  useEffectMock: vi.fn(),
  useRouterMock: vi.fn(),
  useStateMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useEffect: useEffectMock,
    useState: useStateMock,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: useRouterMock,
}));

import { DashboardWorkspace } from "./dashboard-workspace";

function buildRunMetadata() {
  return {
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
  beforeEach(() => {
    vi.clearAllMocks();
    useRouterMock.mockReturnValue({
      push: vi.fn(),
    });
    useEffectMock.mockImplementation(() => undefined);
    useStateMock
      .mockReturnValueOnce([
        {
          status: "ready",
          data: {
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
          error: null,
        },
        vi.fn(),
      ])
      .mockReturnValueOnce([
        {
          campaignManagerUserId: "",
          client: "",
          market: "",
        },
        vi.fn(),
      ])
      .mockReturnValueOnce([0, vi.fn()])
      .mockReturnValueOnce([
        {
          action: null,
          runId: null,
          status: "idle",
          message: "",
        },
        vi.fn(),
      ]);
  });

  it("renders Week 7 dashboard filters, metadata columns, and run actions", () => {
    const html = renderToStaticMarkup(createElement(DashboardWorkspace));

    expect(html).toContain("Runs");
    expect(html).toContain("Campaign Manager");
    expect(html).toContain("Client");
    expect(html).toContain("Market");
    expect(html).toContain("Brief Link");
    expect(html).toContain("Influencer List");
    expect(html).toContain("Coverage");
    expect(html).toContain("Actions");
    expect(html).toContain('href="/runs/run-1"');
    expect(html).toContain(">Gaming run<");
    expect(html).toContain(">Sony<");
    expect(html).toContain(">DACH<");
    expect(html).toContain(">Manager<");
    expect(html).toContain('href="https://example.com/brief"');
    expect(html).toContain("60% coverage · 12/20");
    expect(html).toContain("Export");
    expect(html).toContain("HubSpot");
    expect(html).toContain("All campaign managers");
    expect(html).toContain("All clients");
    expect(html).toContain("All markets");
  });
});
