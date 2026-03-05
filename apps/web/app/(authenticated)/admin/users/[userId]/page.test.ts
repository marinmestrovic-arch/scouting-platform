import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  redirectMock: vi.fn()
}));

vi.mock("../../../../../auth", () => ({
  auth: authMock
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock
}));

import AdminUserDetailPage from "./page";

describe("admin user detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to login", async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await AdminUserDetailPage();

    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(result).toBeNull();
  });

  it("redirects sessions without user to login", async () => {
    authMock.mockResolvedValueOnce({});

    const result = await AdminUserDetailPage();

    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("redirects authenticated non-admin users to forbidden", async () => {
    authMock.mockResolvedValueOnce({
      user: {
        role: "user"
      }
    });

    const result = await AdminUserDetailPage();

    expect(redirectMock).toHaveBeenCalledWith("/forbidden");
    expect(result).toBeNull();
  });

  it("redirects unknown roles to forbidden", async () => {
    authMock.mockResolvedValueOnce({
      user: {
        role: "owner"
      }
    });

    const result = await AdminUserDetailPage();

    expect(redirectMock).toHaveBeenCalledWith("/forbidden");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("renders placeholder for admin role", async () => {
    authMock.mockResolvedValueOnce({
      user: {
        role: "admin"
      }
    });

    const html = renderToStaticMarkup(await AdminUserDetailPage());

    expect(redirectMock).not.toHaveBeenCalled();
    expect(html).toContain("User Account Detail");
    expect(html).toContain("Per-user account and YouTube key state shell lands in Week 1.");
  });
});
