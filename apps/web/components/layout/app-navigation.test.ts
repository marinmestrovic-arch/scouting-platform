import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppNavigation } from "./app-navigation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/catalog",
}));

describe("app navigation", () => {
  it("renders only shared links for user role", () => {
    const html = renderToStaticMarkup(AppNavigation({ role: "user" }));
    const linkCount = (html.match(/class="app-nav__link"/g) ?? []).length;

    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/new-scouting"');
    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/runs"');
    expect(html).toContain('href="/campaigns"');
    expect(html).not.toContain('href="/admin"');
    expect(linkCount).toBe(5);
  });

  it("renders admin link for admin role", () => {
    const html = renderToStaticMarkup(AppNavigation({ role: "admin" }));
    const linkCount = (html.match(/class="app-nav__link"/g) ?? []).length;

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/new-scouting"');
    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/runs"');
    expect(html).toContain('href="/campaigns"');
    expect(html).toContain('href="/admin"');
    expect(linkCount).toBe(6);
  });
});
