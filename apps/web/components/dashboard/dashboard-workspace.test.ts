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
                status: "completed",
                lastError: null,
                createdAt: "2026-03-15T12:00:00.000Z",
                updatedAt: "2026-03-15T13:00:00.000Z",
                startedAt: "2026-03-15T12:01:00.000Z",
                completedAt: "2026-03-15T13:00:00.000Z",
                resultCount: 12,
              },
            ],
          },
          error: null,
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

  it("renders scaffolded planning controls and live run actions", () => {
    const html = renderToStaticMarkup(createElement(DashboardWorkspace));

    expect(html).toContain("Dashboard");
    expect(html).toContain("Requires campaign planning metadata backend");
    expect(html).toContain("Client and Market");
    expect(html).toContain("Campaign manager");
    expect(html).toContain("Target");
    expect(html).toContain("Coverage");
    expect(html).toContain("Actions");
    expect(html).toContain('href="/database?tab=runs&amp;runId=run-1"');
    expect(html).toContain("Export");
    expect(html).toContain("HubSpot");
    expect((html.match(/<select disabled=""/g) ?? []).length).toBe(3);
  });
});
