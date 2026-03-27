import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, redirectMock, pushMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  redirectMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("../../../../auth", () => ({
  auth: authMock
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({
    push: pushMock,
  }),
}));

import AdminUsersPage from "./page";

describe("admin users page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to login", async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await AdminUsersPage();

    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(result).toBeNull();
  });

  it("redirects sessions without user to login", async () => {
    authMock.mockResolvedValueOnce({});

    const result = await AdminUsersPage();

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

    const result = await AdminUsersPage();

    expect(redirectMock).toHaveBeenCalledWith("/forbidden");
    expect(result).toBeNull();
  });

  it("redirects unknown roles to forbidden", async () => {
    authMock.mockResolvedValueOnce({
      user: {
        role: "owner"
      }
    });

    const result = await AdminUsersPage();

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

    const html = renderToStaticMarkup(await AdminUsersPage());

    expect(redirectMock).not.toHaveBeenCalled();
    expect(html).toContain("User Management");
    expect(html).toContain("Create users and reset passwords for campaign managers.");
    expect(html).toContain("Create user");
    expect(html).toContain("Loading users...");
  });
});
