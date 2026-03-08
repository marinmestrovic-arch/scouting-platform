import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../components/catalog/catalog-table-shell", () => ({
  CatalogTableShell: () => "catalog-table-shell",
}));

import CatalogPage from "./page";

describe("catalog page", () => {
  it("renders the catalog table shell", () => {
    const html = renderToStaticMarkup(CatalogPage());

    expect(html).toContain("Catalog");
    expect(html).toContain("Browse the shared creator catalog. Filters land in Week 2.");
    expect(html).toContain("catalog-table-shell");
    expect(html).not.toContain("Catalog list and filtering UX lands in Week 1.");
    expect(html).not.toContain("Week 1 shell paths");
    expect(html).not.toContain("/catalog/[channelId]");
  });
});
