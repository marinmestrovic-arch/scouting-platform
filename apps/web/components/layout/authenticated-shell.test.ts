import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthenticatedShell } from "./authenticated-shell";

describe("authenticated shell", () => {
  it("renders shared shell chrome with user-visible navigation", () => {
    const html = renderToStaticMarkup(
      AuthenticatedShell({
        role: "user",
        children: "catalog page"
      })
    );

    expect(html).toContain("Internal Workspace");
    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/runs"');
    expect(html).not.toContain('href="/admin"');
    expect(html).toContain("Sign out");
    expect(html).toContain("catalog page");
  });

  it("shows admin navigation entry for admin role", () => {
    const html = renderToStaticMarkup(
      AuthenticatedShell({
        role: "admin",
        children: "admin page"
      })
    );

    expect(html).toContain('href="/admin"');
    expect(html).toContain("admin page");
  });
});
