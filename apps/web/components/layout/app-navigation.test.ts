import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppNavigation } from "./app-navigation";

describe("app navigation", () => {
  it("renders only shared links for user role", () => {
    const html = renderToStaticMarkup(AppNavigation({ role: "user" }));
    const linkCount = (html.match(/class="app-nav__link"/g) ?? []).length;

    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/runs"');
    expect(html).toContain('href="/exports"');
    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain(">Admin<");
    expect(linkCount).toBe(3);
  });

  it("renders admin link for admin role", () => {
    const html = renderToStaticMarkup(AppNavigation({ role: "admin" }));
    const linkCount = (html.match(/class="app-nav__link"/g) ?? []).length;

    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/runs"');
    expect(html).toContain('href="/exports"');
    expect(html).toContain('href="/admin"');
    expect(html).toContain(">Admin<");
    expect(linkCount).toBe(4);
  });
});
