import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
  it("renders the legacy database catalog shortcut", () => {
    const html = renderToStaticMarkup(CatalogPage());

    expect(html).toContain("Catalog");
    expect(html).toContain(
      "Legacy shortcut to the Database catalog tab. The catalog remains the canonical creator workspace for filters, selection, export, and HubSpot actions.",
    );
    expect(databaseWorkspaceMock.mock.calls[0]?.[0]).toEqual({
      forcedTab: "catalog",
      showLegacyNotice: true,
    });
    expect(html).toContain("database-workspace:catalog:true");
  });
});
