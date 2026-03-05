import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  redirectMock: vi.fn()
}));

vi.mock("../../auth", () => ({
  auth: authMock
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock
}));

import AuthenticatedLayout from "./layout";

describe("authenticated app layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to login", async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await AuthenticatedLayout({ children: "route body" });

    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(result).toBeNull();
  });

  it("renders shared shell links for user role", async () => {
    authMock.mockResolvedValueOnce({
      user: {
        role: "user"
      }
    });

    const html = renderToStaticMarkup(await AuthenticatedLayout({ children: "catalog" }));

    expect(redirectMock).not.toHaveBeenCalled();
    expect(html).toContain("Internal Workspace");
    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/runs"');
    expect(html).not.toContain('href="/admin"');
  });

  it("renders admin navigation for admin role", async () => {
    authMock.mockResolvedValueOnce({
      user: {
        role: "admin"
      }
    });

    const html = renderToStaticMarkup(await AuthenticatedLayout({ children: "admin" }));

    expect(html).toContain('href="/admin"');
  });
});
