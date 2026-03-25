import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type OperationStatus = {
  type: "idle" | "success" | "error";
  message: string;
};

const { useStateMock, updateAdminUserProfileMock, updateAdminUserYoutubeKeyMock } = vi.hoisted(() => ({
  useStateMock: vi.fn(),
  updateAdminUserProfileMock: vi.fn(),
  updateAdminUserYoutubeKeyMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useState: useStateMock,
  };
});

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

vi.mock("../../lib/admin-users-api", () => ({
  updateAdminUserProfile: updateAdminUserProfileMock,
  updateAdminUserYoutubeKey: updateAdminUserYoutubeKeyMock,
}));

import { UserAccountDetail } from "./user-account-detail";

const user = {
  id: "6eff691f-d178-46f4-ae25-8cfd8d5c2f45",
  email: "campaign@example.com",
  name: "Campaign User",
  role: "user" as const,
  userType: "campaign_manager" as const,
  isActive: true,
  youtubeKeyAssigned: false,
  createdAt: "2026-03-06T10:00:00.000Z",
  updatedAt: "2026-03-06T10:00:00.000Z",
};

function mockComponentState(overrides: {
  name?: string;
  userType?: "admin" | "campaign_manager" | "campaign_lead" | "hoc";
  youtubeKeyAssigned?: boolean;
  youtubeApiKey?: string;
  isUpdatingProfile?: boolean;
  profileStatus?: OperationStatus;
  isUpdatingKey?: boolean;
  updateStatus?: OperationStatus;
} = {}) {
  const setName = vi.fn();
  const setUserType = vi.fn();
  const setYoutubeKeyAssigned = vi.fn();
  const setYoutubeApiKey = vi.fn();
  const setIsUpdatingProfile = vi.fn();
  const setProfileStatus = vi.fn();
  const setIsUpdatingKey = vi.fn();
  const setUpdateStatus = vi.fn();

  useStateMock.mockReset();
  useStateMock.mockReturnValueOnce([overrides.name ?? user.name, setName]);
  useStateMock.mockReturnValueOnce([overrides.userType ?? user.userType, setUserType]);
  useStateMock.mockReturnValueOnce([
    overrides.youtubeKeyAssigned ?? user.youtubeKeyAssigned,
    setYoutubeKeyAssigned,
  ]);
  useStateMock.mockReturnValueOnce([overrides.youtubeApiKey ?? "", setYoutubeApiKey]);
  useStateMock.mockReturnValueOnce([overrides.isUpdatingKey ?? false, setIsUpdatingKey]);
  useStateMock.mockReturnValueOnce([overrides.isUpdatingProfile ?? false, setIsUpdatingProfile]);
  useStateMock.mockReturnValueOnce([
    overrides.profileStatus ?? {
      type: "idle",
      message: "",
    },
    setProfileStatus,
  ]);
  useStateMock.mockReturnValueOnce([
    overrides.updateStatus ?? {
      type: "idle",
      message: "",
    },
    setUpdateStatus,
  ]);

  return {
    setName,
    setUserType,
    setYoutubeKeyAssigned,
    setYoutubeApiKey,
    setIsUpdatingProfile,
    setProfileStatus,
    setIsUpdatingKey,
    setUpdateStatus,
  };
}

function findElementsByType(node: ReactNode, type: string): ReactElement[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findElementsByType(child, type));
  }

  if (!isValidElement(node)) {
    return [];
  }

  const element = node as ReactElement<{ children?: ReactNode }>;

  return [
    ...(element.type === type ? [element] : []),
    ...findElementsByType(element.props.children, type),
  ];
}

function findYoutubeKeyForm(
  tree: ReactNode,
): ReactElement<{ onSubmit: (event: { preventDefault: () => void }) => Promise<void> | void }> | null {
  const forms = findElementsByType(tree, "form") as Array<
    ReactElement<{ onSubmit: (event: { preventDefault: () => void }) => Promise<void> | void }>
  >;

  return forms[1] ?? null;
}

describe("user account detail", () => {
  const secretSentinel = "AIzaStoredSecretSentinel123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders missing YouTube key state", () => {
    mockComponentState({
      youtubeKeyAssigned: false,
    });

    const html = renderToStaticMarkup(
      createElement(UserAccountDetail, {
        user: {
          ...user,
          youtubeKeyAssigned: false,
        },
      }),
    );

    expect(html).toContain("Account identity");
    expect(html).toContain("campaign@example.com");
    expect(html).toContain("Missing");
    expect(html).toContain("Assign YouTube API key");
    expect(html).toContain("The stored key is never shown here.");
    expect(html).toContain("/admin/users");
    expect(html).not.toContain(secretSentinel);
  });

  it("renders assigned YouTube key state", () => {
    mockComponentState({
      youtubeKeyAssigned: true,
    });

    const html = renderToStaticMarkup(
      createElement(UserAccountDetail, {
        user: {
          ...user,
          youtubeKeyAssigned: true,
        },
      }),
    );

    expect(html).toContain("Assigned");
    expect(html).toContain("Replace YouTube Data API key");
    expect(html).toContain("Update YouTube API key");
    expect(html).not.toContain(secretSentinel);
  });

  it("submits a YouTube key update without exposing the secret", async () => {
    const secret = "yt-secret-123";
    const setters = mockComponentState({
      youtubeKeyAssigned: false,
      youtubeApiKey: secret,
    });
    updateAdminUserYoutubeKeyMock.mockResolvedValueOnce({ ok: true });

    const tree = UserAccountDetail({
      user: {
        ...user,
        youtubeKeyAssigned: false,
      },
    });
    const form = findYoutubeKeyForm(tree);

    expect(form).not.toBeNull();

    await form?.props.onSubmit({
      preventDefault: vi.fn(),
    });

    expect(updateAdminUserYoutubeKeyMock).toHaveBeenCalledWith(user.id, {
      youtubeApiKey: secret,
    });
    expect(setters.setIsUpdatingKey).toHaveBeenNthCalledWith(1, true);
    expect(setters.setUpdateStatus).toHaveBeenNthCalledWith(1, {
      type: "idle",
      message: "",
    });
    expect(setters.setYoutubeKeyAssigned).toHaveBeenCalledWith(true);
    expect(setters.setYoutubeApiKey).toHaveBeenCalledWith("");
    expect(setters.setUpdateStatus).toHaveBeenNthCalledWith(2, {
      type: "success",
      message: "YouTube API key assigned.",
    });
    expect(JSON.stringify(setters.setUpdateStatus.mock.calls)).not.toContain(secret);
    expect(setters.setIsUpdatingKey).toHaveBeenLastCalledWith(false);
  });

  it("visibly rerenders from missing to assigned after successful first-time assignment", async () => {
    const secret = "AIzaFreshSecret123";

    mockComponentState({
      youtubeKeyAssigned: false,
      youtubeApiKey: secret,
    });

    const initialTree = UserAccountDetail({
      user: {
        ...user,
        youtubeKeyAssigned: false,
      },
    });
    const initialHtml = renderToStaticMarkup(initialTree);
    const form = findYoutubeKeyForm(initialTree);

    expect(initialHtml).toContain("Missing");
    expect(initialHtml).toContain("Assign YouTube API key");
    expect(form).not.toBeNull();

    updateAdminUserYoutubeKeyMock.mockResolvedValueOnce({ ok: true });

    await form?.props.onSubmit({
      preventDefault: vi.fn(),
    });

    mockComponentState({
      youtubeKeyAssigned: true,
      youtubeApiKey: "",
      updateStatus: {
        type: "success",
        message: "YouTube API key assigned.",
      },
    });

    const rerenderedHtml = renderToStaticMarkup(
      createElement(UserAccountDetail, {
        user: {
          ...user,
          youtubeKeyAssigned: true,
        },
      }),
    );

    expect(rerenderedHtml).toContain("Assigned");
    expect(rerenderedHtml).toContain("Replace YouTube Data API key");
    expect(rerenderedHtml).toContain("Update YouTube API key");
    expect(rerenderedHtml).toContain("YouTube API key assigned.");
    expect(rerenderedHtml).not.toContain(secret);
    expect(rerenderedHtml).not.toContain(secretSentinel);
  });

  it("submits an assigned user's replacement key without exposing the secret", async () => {
    const secret = "AIzaUpdatedSecret123";
    const setters = mockComponentState({
      youtubeKeyAssigned: true,
      youtubeApiKey: secret,
    });
    updateAdminUserYoutubeKeyMock.mockResolvedValueOnce({ ok: true });

    const tree = UserAccountDetail({
      user: {
        ...user,
        youtubeKeyAssigned: true,
      },
    });
    const form = findYoutubeKeyForm(tree);

    expect(form).not.toBeNull();

    await form?.props.onSubmit({
      preventDefault: vi.fn(),
    });

    expect(updateAdminUserYoutubeKeyMock).toHaveBeenCalledWith(user.id, {
      youtubeApiKey: secret,
    });
    expect(setters.setYoutubeKeyAssigned).toHaveBeenCalledWith(true);
    expect(setters.setYoutubeApiKey).toHaveBeenCalledWith("");
    expect(setters.setUpdateStatus).toHaveBeenNthCalledWith(2, {
      type: "success",
      message: "YouTube API key updated.",
    });
    expect(JSON.stringify(setters.setUpdateStatus.mock.calls)).not.toContain(secret);
    expect(setters.setIsUpdatingKey).toHaveBeenLastCalledWith(false);
  });

  it("surfaces YouTube key update failures", async () => {
    const setters = mockComponentState({
      youtubeKeyAssigned: true,
      youtubeApiKey: "yt-secret-123",
    });
    updateAdminUserYoutubeKeyMock.mockRejectedValueOnce(new Error("User not found"));

    const tree = UserAccountDetail({
      user: {
        ...user,
        youtubeKeyAssigned: true,
      },
    });
    const form = findYoutubeKeyForm(tree);

    expect(form).not.toBeNull();

    await form?.props.onSubmit({
      preventDefault: vi.fn(),
    });

    expect(setters.setUpdateStatus).toHaveBeenNthCalledWith(2, {
      type: "error",
      message: "User not found",
    });
    expect(JSON.stringify(setters.setUpdateStatus.mock.calls)).not.toContain("yt-secret-123");
    expect(setters.setYoutubeKeyAssigned).not.toHaveBeenCalled();
    expect(setters.setIsUpdatingKey).toHaveBeenLastCalledWith(false);
  });

  it("suppresses hydration warnings on the YouTube key form, input, and submit button", () => {
    mockComponentState({
      youtubeKeyAssigned: false,
    });

    const tree = UserAccountDetail({
      user: {
        ...user,
        youtubeKeyAssigned: false,
      },
    });
    const forms = findElementsByType(tree, "form") as Array<
      ReactElement<{
        suppressHydrationWarning?: boolean;
      }>
    >;
    const inputs = findElementsByType(tree, "input") as Array<
      ReactElement<{
        suppressHydrationWarning?: boolean;
      }>
    >;
    const buttons = findElementsByType(tree, "button") as Array<
      ReactElement<{
        suppressHydrationWarning?: boolean;
      }>
    >;
    const form = forms[1] ?? null;
    const input = inputs[1] ?? null;
    const button = buttons[1] ?? null;

    expect(form?.props.suppressHydrationWarning).toBe(true);
    expect(input?.props.suppressHydrationWarning).toBe(true);
    expect(button?.props.suppressHydrationWarning).toBe(true);
  });
});
