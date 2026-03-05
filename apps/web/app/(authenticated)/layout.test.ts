import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AuthenticatedLayout from "./layout";

describe("authenticated app layout", () => {
  it("wraps pages in shell chrome", () => {
    const html = renderToStaticMarkup(AuthenticatedLayout({ children: "route body" }));

    expect(html).toContain("Internal Workspace");
    expect(html).toContain("Scouting Platform");
    expect(html).toContain("route body");
  });

  it("uses default role shell navigation baseline", () => {
    const html = renderToStaticMarkup(AuthenticatedLayout({ children: "catalog" }));

    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/runs"');
    expect(html).not.toContain('href="/admin"');
  });
});
