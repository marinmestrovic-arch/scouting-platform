import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppNavigation } from "./app-navigation";

describe("app navigation", () => {
  it("renders only shared links for user role", () => {
    const html = renderToStaticMarkup(AppNavigation({ role: "user" }));

    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/runs"');
    expect(html).not.toContain('href="/admin"');
  });

  it("renders admin link for admin role", () => {
    const html = renderToStaticMarkup(AppNavigation({ role: "admin" }));

    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/runs"');
    expect(html).toContain('href="/admin"');
  });
});
