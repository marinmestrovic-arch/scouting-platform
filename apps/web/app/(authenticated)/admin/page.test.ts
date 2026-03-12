import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  redirectMock: vi.fn()
}));

vi.mock("../../../auth", () => ({
  auth: authMock
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock
}));

vi.mock("../../../components/admin/admin-dashboard-shell", () => ({
  AdminDashboardShell: () => "Admin dashboard shell"
}));

vi.mock("../../../components/admin/admin-advanced-report-queue", () => ({
  AdminAdvancedReportQueue: () => "Admin approval queue"
}));

import AdminPage from "./page";

describe("admin page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to login", async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await AdminPage();

    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).not.toHaveBeenCalledWith("/forbidden");
    expect(result).toBeNull();
  });

  it("redirects sessions without user to login", async () => {
    authMock.mockResolvedValueOnce({});

    const result = await AdminPage();

    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).not.toHaveBeenCalledWith("/forbidden");
    expect(result).toBeNull();
  });

  it("redirects authenticated non-admin users to forbidden", async () => {
    authMock.mockResolvedValueOnce({
      user: {
        role: "user"
      }
    });

    const result = await AdminPage();

    expect(redirectMock).toHaveBeenCalledWith("/forbidden");
    expect(result).toBeNull();
  });

  it("redirects users with unknown roles to forbidden", async () => {
    authMock.mockResolvedValueOnce({
      user: {
        role: "owner"
      }
    });

    const result = await AdminPage();

    expect(redirectMock).toHaveBeenCalledWith("/forbidden");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("renders admin dashboard overview and approval queue for admin role", async () => {
    authMock.mockResolvedValueOnce({
      user: {
        role: "admin"
      }
    });

    const html = renderToStaticMarkup(await AdminPage());

    expect(redirectMock).not.toHaveBeenCalled();
    expect(html).toContain("Admin");
    expect(html).toContain(
      "Track current admin workload, catch setup gaps early, and work the full HypeAuditor approval queue from one workspace."
    );
    expect(html).toContain("Admin dashboard shell");
    expect(html).toContain("Admin approval queue");
    expect(html).toContain("admin-approval-queue");
    expect(html.indexOf("Admin dashboard shell")).toBeLessThan(html.indexOf("Admin approval queue"));
  });
});
