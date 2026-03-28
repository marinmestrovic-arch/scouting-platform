import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStringAsync } from "../../../../../lib/test-render";

const { getSessionMock, listUsersMock, notFoundMock, redirectMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  listUsersMock: vi.fn(),
  notFoundMock: vi.fn(),
  redirectMock: vi.fn()
}));

vi.mock("../../../../../lib/cached-auth", () => ({
  getSession: getSessionMock
}));

vi.mock("@scouting-platform/core", () => ({
  listUsers: listUsersMock,
}));

vi.mock("next/link", async () => {
  const react = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      href,
      className,
      children,
    }: {
      href: string;
      className?: string;
      children: ReactNode;
    }) => react.createElement("a", { href, className }, children),
  };
});

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  redirect: redirectMock
}));

import AdminUserDetailPage from "./page";

describe("admin user detail page", () => {
  const secretSentinel = "AIzaStoredSecretSentinel123";
  const missingKeyUser = {
    id: "6eff691f-d178-46f4-ae25-8cfd8d5c2f45",
    email: "campaign@example.com",
    name: "Campaign User",
    role: "user" as const,
    isActive: true,
    youtubeKeyAssigned: false,
    createdAt: "2026-03-06T10:00:00.000Z",
    updatedAt: "2026-03-06T10:00:00.000Z",
  };

  const assignedKeyUser = {
    ...missingKeyUser,
    id: "81d86667-a640-4f4d-9609-4d0319ed35ff",
    email: "assigned@example.com",
    youtubeKeyAssigned: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to login", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    await renderToStringAsync(
      await AdminUserDetailPage({
        params: Promise.resolve({ userId: missingKeyUser.id }),
      }),
    );

    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it("redirects sessions without user to login", async () => {
    getSessionMock.mockResolvedValueOnce({});

    await renderToStringAsync(
      await AdminUserDetailPage({
        params: Promise.resolve({ userId: missingKeyUser.id }),
      }),
    );

    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it("redirects authenticated non-admin users to forbidden", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        role: "user"
      }
    });

    await renderToStringAsync(
      await AdminUserDetailPage({
        params: Promise.resolve({ userId: missingKeyUser.id }),
      }),
    );

    expect(redirectMock).toHaveBeenCalledWith("/forbidden");
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it("redirects unknown roles to forbidden", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        role: "owner"
      }
    });

    await renderToStringAsync(
      await AdminUserDetailPage({
        params: Promise.resolve({ userId: missingKeyUser.id }),
      }),
    );

    expect(redirectMock).toHaveBeenCalledWith("/forbidden");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it("renders missing YouTube key state for the selected user", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        role: "admin"
      }
    });
    listUsersMock.mockResolvedValueOnce([missingKeyUser]);

    const html = await renderToStringAsync(
      await AdminUserDetailPage({
        params: Promise.resolve({ userId: missingKeyUser.id }),
      }),
    );

    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(html).toContain("Campaign User");
    expect(html).toContain("campaign@example.com");
    expect(html).toContain("Missing");
    expect(html).toContain("Assign YouTube API key");
    expect(html).not.toContain(secretSentinel);
  });

  it("renders assigned YouTube key state for the selected user", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        role: "admin"
      }
    });
    listUsersMock.mockResolvedValueOnce([assignedKeyUser]);

    const html = await renderToStringAsync(
      await AdminUserDetailPage({
        params: Promise.resolve({ userId: assignedKeyUser.id }),
      }),
    );

    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(html).toContain("assigned@example.com");
    expect(html).toContain("Assigned");
    expect(html).toContain("Update YouTube API key");
    expect(html).not.toContain(secretSentinel);
  });

  it("calls notFound for unknown users", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: {
        role: "admin"
      }
    });
    listUsersMock.mockResolvedValueOnce([assignedKeyUser]);

    await renderToStringAsync(
      await AdminUserDetailPage({
        params: Promise.resolve({ userId: missingKeyUser.id }),
      }),
    );

    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
