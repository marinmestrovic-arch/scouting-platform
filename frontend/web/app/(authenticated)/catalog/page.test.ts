import { describe, expect, it, vi } from "vitest";
import { renderToStringAsync } from "../../../lib/test-render";

const {
  getSessionMock,
  listChannelsMock,
  listDropdownValuesMock,
  listUserSegmentsMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({
    user: {
      id: "user-1",
      role: "user",
    },
  })),
  listChannelsMock: vi.fn(async () => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })),
  listDropdownValuesMock: vi.fn(async () => ({
    items: [],
  })),
  listUserSegmentsMock: vi.fn(async () => []),
}));

vi.mock("../../../lib/cached-auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("../../../lib/cached-data", () => ({
  getCachedChannels: listChannelsMock,
  getCachedDropdownValues: listDropdownValuesMock,
  getCachedUserSegments: listUserSegmentsMock,
}));

vi.mock("../../../components/catalog/catalog-table-shell", () => ({
  CatalogTableShell: () => "catalog-table-shell",
}));

const { databaseWorkspaceMock } = vi.hoisted(() => ({
  databaseWorkspaceMock: vi.fn(({ forcedTab, showLegacyNotice }: { forcedTab?: string; showLegacyNotice?: boolean }) =>
    `database-workspace:${String(forcedTab)}:${String(showLegacyNotice)}`,
  ),
}));

vi.mock("../../../components/database/database-workspace", () => ({
  DatabaseWorkspace: databaseWorkspaceMock,
}));

import CatalogPage from "./page";

describe("catalog page", () => {
  it("renders the catalog workspace page", async () => {
    const html = await renderToStringAsync(CatalogPage({}));

    expect(html).toContain("Catalog");
    expect(html).toContain(
      "Browse the canonical creator catalog with creator filters and table or card browsing modes.",
    );
    expect(databaseWorkspaceMock.mock.calls[0]?.[0]).toEqual({
      forcedTab: "catalog",
      initialCatalogData: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      },
      catalogCreatorFilterOptions: {
        countryRegion: [],
        influencerType: [],
        influencerVertical: [],
      },
      initialSavedSegments: [],
    });
    expect(html).toContain("database-workspace:catalog:undefined");
  });
});
