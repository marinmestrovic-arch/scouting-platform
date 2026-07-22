import { createElement } from "react";
import type { ListHubspotObjectSyncRunsResponse } from "@scouting-platform/contracts";
import { renderToStringAsync } from "../../lib/test-render";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replaceMock, refreshMock, useRouterMock, useSearchParamsMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
  useRouterMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: useRouterMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock("next/dynamic", () => ({
  default: (importFn: () => Promise<unknown>) => {
    let Resolved: unknown = null;
    importFn().then((mod) => {
      Resolved = mod;
    });

    return function DynamicComponent(props: Record<string, unknown>) {
      if (typeof Resolved === "function") {
        return Resolved(props);
      }

      return null;
    };
  },
}));

vi.mock("../campaigns/campaigns-workspace", () => ({
  CampaignsWorkspace: () => "campaigns-workspace",
}));

vi.mock("../database/clients-workspace", () => ({
  ClientsWorkspace: () => "clients-workspace",
}));

vi.mock("./dropdown-values-workspace", () => ({
  DropdownValuesWorkspace: () => "dropdown-values-workspace",
}));

vi.mock("./hubspot-integration-workspace", () => ({
  HubspotIntegrationWorkspace: () => "hubspot-integration-workspace",
}));

import { DatabaseAdminWorkspace } from "./database-admin-workspace";

const campaigns = {
  items: [],
  filterOptions: {
    clients: [],
    markets: [],
    statuses: [],
  },
  permissions: {
    canCreate: true,
    role: "admin" as const,
    userType: "admin" as const,
  },
};

const clients = {
  items: [],
  permissions: {
    canCreate: true,
    role: "admin" as const,
    userType: "admin" as const,
  },
};

const latestSyncRun = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "completed" as const,
  objectTypes: ["clients" as const, "campaigns" as const, "dropdownValues" as const],
  clientUpsertCount: 2,
  campaignUpsertCount: 3,
  deactivatedCount: 1,
  startedAt: "2026-04-22T09:59:00.000Z",
  completedAt: "2026-04-22T10:00:00.000Z",
  lastError: "Skipped 27 HubSpot campaign objects.",
  createdAt: "2026-04-22T09:59:00.000Z",
  updatedAt: "2026-04-22T10:00:00.000Z",
};

const hubspotSyncRuns: ListHubspotObjectSyncRunsResponse = {
  items: [
    latestSyncRun,
  ],
  latest: latestSyncRun,
};

describe("DatabaseAdminWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRouterMock.mockReturnValue({
      replace: replaceMock,
      refresh: refreshMock,
    });
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
  });

  it("shows the HubSpot sync action for admins without the old summary block", async () => {
    const html = await renderToStringAsync(
      createElement(DatabaseAdminWorkspace, {
        campaigns,
        clients,
        dropdownValues: [],
        hubspotSyncRuns,
        isAdmin: true,
      }),
    );

    expect(html).toContain("Clients");
    expect(html).toContain("Campaigns");
    expect(html).toContain("Dropdown Values");
    expect(html).toContain("HubSpot");
    expect(html).toContain("Sync from HubSpot");
    expect(html).not.toContain("Last run:");
    expect(html).not.toContain("Deactivated");
    expect(html).not.toContain("Skipped 27");
  });

  it("does not show the sync action to non-admin users", async () => {
    const html = await renderToStringAsync(
      createElement(DatabaseAdminWorkspace, {
        campaigns,
        clients,
        dropdownValues: [],
        hubspotSyncRuns: { items: [], latest: null },
        isAdmin: false,
      }),
    );

    expect(html).not.toContain("Sync from HubSpot");
    expect(html).not.toContain(">HubSpot<");
  });

  it("opens the admin-only HubSpot health and conflicts workspace", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("tab=hubspot"));

    const html = await renderToStringAsync(
      createElement(DatabaseAdminWorkspace, {
        campaigns,
        clients,
        dropdownValues: [],
        hubspotSyncRuns,
        isAdmin: true,
      }),
    );

    expect(html).toContain("hubspot-integration-workspace");
  });
});
