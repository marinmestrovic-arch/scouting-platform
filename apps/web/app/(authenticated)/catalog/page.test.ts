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
  it("renders the catalog workspace page", () => {
    const html = renderToStaticMarkup(CatalogPage());

    expect(html).toContain("Catalog");
    expect(html).toContain(
      "Browse the canonical creator catalog with full-width filters, enrichment actions, and export shortcuts.",
    );
    expect(databaseWorkspaceMock.mock.calls[0]?.[0]).toEqual({
      forcedTab: "catalog",
    });
    expect(html).toContain("database-workspace:catalog:undefined");
  });
});
