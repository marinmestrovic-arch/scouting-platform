import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type OperationStatus = {
  type: "idle" | "success" | "error";
  message: string;
};

type ComponentState = {
  users: Array<{
    id: string;
    email: string;
    name: string | null;
    role: "admin" | "user";
    isActive: boolean;
    youtubeKeyAssigned: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  isLoadingUsers: boolean;
  usersError: string | null;
  createUserForm: {
    email: string;
    name: string;
    role: "admin" | "user";
    password: string;
  };
  isCreatingUser: boolean;
  createUserStatus: OperationStatus;
  passwordDraftByUserId: Record<string, string>;
  passwordStatusByUserId: Record<string, OperationStatus>;
  pendingPasswordUserId: string | null;
};

const {
  useStateMock,
  useEffectMock,
  useMemoMock,
  useCallbackMock,
  createAdminUserMock,
  fetchAdminUsersMock,
  updateAdminUserPasswordMock,
} = vi.hoisted(() => ({
  useStateMock: vi.fn(),
  useEffectMock: vi.fn(),
  useMemoMock: vi.fn(),
  useCallbackMock: vi.fn(),
  createAdminUserMock: vi.fn(),
  fetchAdminUsersMock: vi.fn(),
  updateAdminUserPasswordMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useState: useStateMock,
    useEffect: useEffectMock,
    useMemo: useMemoMock,
    useCallback: useCallbackMock,
  };
});

vi.mock("../../lib/admin-users-api", () => ({
  createAdminUser: createAdminUserMock,
  fetchAdminUsers: fetchAdminUsersMock,
  updateAdminUserPassword: updateAdminUserPasswordMock,
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

import { AdminUsersManager } from "./admin-users-manager";

const DEFAULT_STATE: ComponentState = {
  users: [],
  isLoadingUsers: true,
  usersError: null,
  createUserForm: {
    email: "",
    name: "",
    role: "user",
    password: "",
  },
  isCreatingUser: false,
  createUserStatus: {
    type: "idle",
    message: "",
  },
  passwordDraftByUserId: {},
  passwordStatusByUserId: {},
  pendingPasswordUserId: null,
};

function mockComponentState(overrides: Partial<ComponentState>) {
  const state: ComponentState = {
    ...DEFAULT_STATE,
    ...overrides,
  };

  useStateMock.mockReset();
  useStateMock.mockReturnValueOnce([state.users, vi.fn()]);
  useStateMock.mockReturnValueOnce([state.isLoadingUsers, vi.fn()]);
  useStateMock.mockReturnValueOnce([state.usersError, vi.fn()]);
  useStateMock.mockReturnValueOnce([state.createUserForm, vi.fn()]);
  useStateMock.mockReturnValueOnce([state.isCreatingUser, vi.fn()]);
  useStateMock.mockReturnValueOnce([state.createUserStatus, vi.fn()]);
  useStateMock.mockReturnValueOnce([state.passwordDraftByUserId, vi.fn()]);
  useStateMock.mockReturnValueOnce([state.passwordStatusByUserId, vi.fn()]);
  useStateMock.mockReturnValueOnce([state.pendingPasswordUserId, vi.fn()]);

  useCallbackMock.mockImplementation((value: unknown) => value);
  useMemoMock.mockImplementation((factory: () => unknown) => factory());
  useEffectMock.mockImplementation(() => undefined);
}

function findForms(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findForms(child));
  }

  if (!isValidElement(node)) {
    return [];
  }

  const element = node as ReactElement<{ children?: ReactNode }>;
  const children = findForms(element.props.children);

  return element.type === "form" ? [element, ...children] : children;
}

describe("admin users manager", () => {
  const assignedUser = {
    id: "6eff691f-d178-46f4-ae25-8cfd8d5c2f45",
    email: "campaign@example.com",
    name: "Campaign User",
    role: "user" as const,
    isActive: true,
    youtubeKeyAssigned: true,
    createdAt: "2026-03-06T10:00:00.000Z",
    updatedAt: "2026-03-06T10:00:00.000Z",
  };
  const missingKeyUser = {
    ...assignedUser,
    id: "0a6fbfd9-7155-4222-850b-70aa73d3a629",
    email: "missing@example.com",
    name: "Missing Key User",
    youtubeKeyAssigned: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders list rows when users load successfully", () => {
    mockComponentState({
      isLoadingUsers: false,
      users: [assignedUser, missingKeyUser],
    });

    const html = renderToStaticMarkup(createElement(AdminUsersManager));

    expect(html).toContain("campaign@example.com");
    expect(html).toContain("Campaign User");
    expect(html).toContain("missing@example.com");
    expect(html).toContain("Missing Key User");
    expect(html).toContain("YouTube key: Assigned");
    expect(html).toContain("YouTube key: Missing");
    expect(html).toContain("Manage account");
    expect(html).toContain(`/admin/users/${assignedUser.id}`);
    expect(html).toContain(`/admin/users/${missingKeyUser.id}`);
    expect(html).toContain("Update password");
  });

  it("renders empty state when no users exist", () => {
    mockComponentState({
      isLoadingUsers: false,
      users: [],
    });

    const html = renderToStaticMarkup(createElement(AdminUsersManager));

    expect(html).toContain("No users found.");
  });

  it("renders create success status", () => {
    mockComponentState({
      isLoadingUsers: false,
      createUserStatus: {
        type: "success",
        message: "User created.",
      },
    });

    const html = renderToStaticMarkup(createElement(AdminUsersManager));

    expect(html).toContain("User created.");
    expect(html).toContain("admin-users__inline-status--success");
  });

  it("renders create error status", () => {
    mockComponentState({
      isLoadingUsers: false,
      createUserStatus: {
        type: "error",
        message: "A user with this email already exists",
      },
    });

    const html = renderToStaticMarkup(createElement(AdminUsersManager));

    expect(html).toContain("A user with this email already exists");
    expect(html).toContain("admin-users__inline-status--error");
    expect(html).toContain('role="alert"');
  });

  it("renders password update success status", () => {
    mockComponentState({
      isLoadingUsers: false,
      users: [assignedUser],
      passwordStatusByUserId: {
        [assignedUser.id]: {
          type: "success",
          message: "Password updated.",
        },
      },
    });

    const html = renderToStaticMarkup(createElement(AdminUsersManager));

    expect(html).toContain("Password updated.");
    expect(html).toContain("admin-users__inline-status--success");
  });

  it("renders password update error status", () => {
    mockComponentState({
      isLoadingUsers: false,
      users: [assignedUser],
      passwordStatusByUserId: {
        [assignedUser.id]: {
          type: "error",
          message: "Unable to complete the request. Please try again.",
        },
      },
    });

    const html = renderToStaticMarkup(createElement(AdminUsersManager));

    expect(html).toContain("Unable to complete the request. Please try again.");
    expect(html).toContain("admin-users__inline-status--error");
    expect(html).toContain('role="alert"');
  });

  it("keeps create-user and password-reset submit flows wired with the account detail link present", async () => {
    const createUserForm = {
      email: "  campaign@example.com  ",
      name: "  Campaign User  ",
      role: "user" as const,
      password: "StrongPassword123",
    };
    const passwordDraftByUserId = {
      [assignedUser.id]: "ResetPassword123",
    };

    mockComponentState({
      isLoadingUsers: false,
      users: [assignedUser],
      createUserForm,
      passwordDraftByUserId,
    });
    createAdminUserMock.mockResolvedValueOnce({
      ...assignedUser,
      youtubeKeyAssigned: false,
    });
    updateAdminUserPasswordMock.mockResolvedValueOnce(assignedUser);

    const tree = AdminUsersManager();
    const forms = findForms(tree);
    const createForm = forms[0] as ReactElement<{
      onSubmit: (event: { preventDefault: () => void }) => Promise<void> | void;
    }> | undefined;
    const passwordForm = forms[1] as ReactElement<{
      onSubmit: (event: { preventDefault: () => void }) => Promise<void> | void;
    }> | undefined;

    expect(renderToStaticMarkup(tree)).toContain(`/admin/users/${assignedUser.id}`);
    expect(createForm).toBeDefined();
    expect(passwordForm).toBeDefined();

    await createForm?.props.onSubmit({
      preventDefault: vi.fn(),
    });

    expect(createAdminUserMock).toHaveBeenCalledWith({
      email: "campaign@example.com",
      name: "Campaign User",
      role: "user",
      password: "StrongPassword123",
    });

    await passwordForm?.props.onSubmit({
      preventDefault: vi.fn(),
    });

    expect(updateAdminUserPasswordMock).toHaveBeenCalledWith(assignedUser.id, {
      password: "ResetPassword123",
    });
  });
});
