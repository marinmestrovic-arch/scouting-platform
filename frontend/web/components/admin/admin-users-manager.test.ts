import type { AdminUserResponse } from "@scouting-platform/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: "a",
}));

import { AdminUsersManagerView } from "./admin-users-manager";

function buildUser(overrides?: Partial<AdminUserResponse>): AdminUserResponse {
  return {
    id: "6eff691f-d178-46f4-ae25-8cfd8d5c2f45",
    email: "campaign@example.com",
    name: "Campaign User",
    role: "user",
    userType: "campaign_manager",
    isActive: true,
    youtubeKeyAssigned: true,
    createdAt: "2026-03-06T10:00:00.000Z",
    updatedAt: "2026-03-06T10:00:00.000Z",
    ...overrides,
  };
}

const BASE_PROPS = {
  createUserForm: {
    email: "",
    name: "",
    role: "user" as const,
    userType: "campaign_manager" as const,
    password: "",
  },
  createUserStatus: {
    type: "idle" as const,
    message: "",
  },
  isCreateOpen: false,
  isCreatingUser: false,
  isLoadingUsers: false,
  onCloseCreate: vi.fn(),
  onCreateUserFormChange: vi.fn(),
  onCreateUserSubmit: vi.fn(),
  onOpenCreate: vi.fn(),
  onRetryUsers: vi.fn(),
  onSelectUser: vi.fn(),
  users: [] as AdminUserResponse[],
  usersError: null as string | null,
};

describe("admin users manager view", () => {
  it("renders table rows with the current user columns and statuses", () => {
    const html = renderToStaticMarkup(
      createElement(AdminUsersManagerView, {
        ...BASE_PROPS,
        users: [
          buildUser(),
          buildUser({
            id: "0a6fbfd9-7155-4222-850b-70aa73d3a629",
            email: "missing@example.com",
            name: "Missing Key User",
            youtubeKeyAssigned: false,
            userType: "hoc",
          }),
        ],
      }),
    );

    expect(html).toContain("Campaign User");
    expect(html).toContain("campaign@example.com");
    expect(html).toContain("Role");
    expect(html).toContain("User type");
    expect(html).toContain("YouTube key");
    expect(html).toContain("Active");
    expect(html).toContain("Assigned");
    expect(html).toContain("Missing");
    expect(html).toContain("Campaign Manager");
    expect(html).toContain("HoC");
    expect(html).toContain('href="/admin/users/6eff691f-d178-46f4-ae25-8cfd8d5c2f45"');
    expect(html).not.toContain("Update password");
  });

  it("renders loading and empty states", () => {
    const loadingHtml = renderToStaticMarkup(
      createElement(AdminUsersManagerView, {
        ...BASE_PROPS,
        isLoadingUsers: true,
      }),
    );
    const emptyHtml = renderToStaticMarkup(
      createElement(AdminUsersManagerView, {
        ...BASE_PROPS,
      }),
    );

    expect(loadingHtml).toContain("Loading users...");
    expect(emptyHtml).toContain("No users found.");
  });

  it("renders retryable error feedback", () => {
    const html = renderToStaticMarkup(
      createElement(AdminUsersManagerView, {
        ...BASE_PROPS,
        usersError: "Unable to complete the request. Please try again.",
      }),
    );

    expect(html).toContain("Unable to complete the request. Please try again.");
    expect(html).toContain("Retry");
    expect(html).toContain('role="alert"');
  });

  it("renders the add-user modal with success and error statuses", () => {
    const successHtml = renderToStaticMarkup(
      createElement(AdminUsersManagerView, {
        ...BASE_PROPS,
        createUserStatus: {
          type: "success",
          message: "User created.",
        },
        isCreateOpen: true,
      }),
    );
    const errorHtml = renderToStaticMarkup(
      createElement(AdminUsersManagerView, {
        ...BASE_PROPS,
        createUserStatus: {
          type: "error",
          message: "A user with this email already exists",
        },
        isCreateOpen: true,
      }),
    );

    expect(successHtml).toContain("Add user");
    expect(successHtml).toContain("Create user");
    expect(successHtml).toContain("User created.");
    expect(successHtml).toContain("admin-users__inline-status--success");
    expect(errorHtml).toContain("A user with this email already exists");
    expect(errorHtml).toContain("admin-users__inline-status--error");
    expect(errorHtml).toContain('role="alert"');
  });
});
