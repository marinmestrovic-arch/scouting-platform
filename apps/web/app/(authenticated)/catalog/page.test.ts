import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CatalogPage from "./page";

describe("catalog page", () => {
  it("renders week 1 placeholder with shell paths", () => {
    const html = renderToStaticMarkup(CatalogPage());

    expect(html).toContain("Catalog");
    expect(html).toContain("Catalog list and filtering UX lands in Week 1.");
    expect(html).toContain("Week 1 shell paths");
    expect(html).toMatch(/<code[^>]*>\/catalog<\/code>/);
    expect(html).toContain("/catalog/[channelId]");
  });
});
