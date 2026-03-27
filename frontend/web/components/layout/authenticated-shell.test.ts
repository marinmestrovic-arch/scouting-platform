import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));
import { AuthenticatedShell } from "./authenticated-shell";

describe("authenticated shell", () => {
  it("renders shared shell chrome with user-visible navigation", () => {
    const html = renderToStaticMarkup(
      AuthenticatedShell({
        role: "user",
        children: "catalog page"
      })
    );

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/new-scouting"');
    expect(html).toContain('href="/database"');
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
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/database"');
    expect(html).toContain('src="/arch-logo.svg"');
    expect(html).not.toContain("ARCH.</span>");
    expect(html).toContain("admin page");
  });

  it("suppresses hydration warnings on the root shell wrapper", () => {
    const tree = AuthenticatedShell({
      role: "user",
      children: "catalog page",
    });

    expect((tree.props as { suppressHydrationWarning?: boolean }).suppressHydrationWarning).toBe(
      true,
    );
  });
});
