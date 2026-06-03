import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppNavigation } from "./app-navigation";

const { prefetchMock } = vi.hoisted(() => ({
  prefetchMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/catalog",
  useRouter: () => ({
    prefetch: prefetchMock,
  }),
}));

describe("app navigation", () => {
  it("renders only shared links for user role", () => {
    const html = renderToStaticMarkup(createElement(AppNavigation, { role: "user" }));
    const linkCount = (html.match(/class="app-nav__link(?: app-nav__link--active)?"/g) ?? []).length;

    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/new-scouting"');
    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/database"');
    expect(html).toContain('href="/feedback"');
    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain(">Workspace<");
    expect(html).not.toContain(">Admin<");
    expect(linkCount).toBe(5);
  });

  it("renders admin link for admin role", () => {
    const html = renderToStaticMarkup(createElement(AppNavigation, { role: "admin" }));
    const linkCount = (html.match(/class="app-nav__link(?: app-nav__link--active)?"/g) ?? []).length;

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/new-scouting"');
    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/database"');
    expect(html).toContain('href="/feedback"');
    expect(html).toContain('href="/admin"');
    expect(html).toContain(">New Scouting<");
    expect(html).not.toContain(">Workspace<");
    expect(linkCount).toBe(6);
  });
});
