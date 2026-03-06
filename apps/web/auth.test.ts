import { describe, expect, it, vi } from "vitest";

const {
  captured,
  nextAuthFactoryMock,
  credentialsProviderMock,
  nextAuthExports,
  findUserForCredentialsMock,
  verifyPasswordMock
} = vi.hoisted(() => {
  const captured = {
    authConfig: null as unknown,
    credentialsOptions: null as unknown
  };

  const nextAuthExports = {
    handlers: {
      GET: vi.fn(),
      POST: vi.fn()
    },
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn()
  };

  return {
    captured,
    nextAuthFactoryMock: vi.fn((authConfig: unknown) => {
      captured.authConfig = authConfig;
      return nextAuthExports;
    }),
    credentialsProviderMock: vi.fn((options: unknown) => {
      captured.credentialsOptions = options;
      return {
        id: "credentials",
        options
      };
    }),
    nextAuthExports,
    findUserForCredentialsMock: vi.fn(),
    verifyPasswordMock: vi.fn()
  };
});

vi.mock("@scouting-platform/core", () => ({
  findUserForCredentials: findUserForCredentialsMock,
  verifyPassword: verifyPasswordMock
}));

vi.mock("next-auth", () => ({
  default: nextAuthFactoryMock
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: credentialsProviderMock
}));

import { authConfig, auth, handlers, resolveAuthSecret, signIn, signOut } from "./auth";

type JwtCallbackParams = {
  token: { role?: unknown; sub?: string };
  user?: { id?: string; role?: unknown } | undefined;
};

type SessionCallbackParams = {
  session: { user?: Record<string, unknown> };
  token: { role?: unknown; sub?: string };
};

type AuthCallbacks = {
  jwt: (params: JwtCallbackParams) => { role?: unknown; sub?: string };
  session: (params: SessionCallbackParams) => { user?: Record<string, unknown> };
};

describe("auth configuration", () => {
  it("keeps the custom sign-in page redirect and JWT session strategy", () => {
    expect(authConfig.pages?.signIn).toBe("/login");
    expect(authConfig.session?.strategy).toBe("jwt");
  });

  it("wires NextAuth exports for route handlers and auth actions", () => {
    expect(nextAuthFactoryMock).toHaveBeenCalledOnce();
    expect(handlers).toBe(nextAuthExports.handlers);
    expect(auth).toBe(nextAuthExports.auth);
    expect(signIn).toBe(nextAuthExports.signIn);
    expect(signOut).toBe(nextAuthExports.signOut);
  });

  it("authorizes active users with persisted credentials and rejects invalid/inactive accounts", async () => {
    const providerOptions = captured.credentialsOptions as {
      authorize: (credentials: { email?: unknown; password?: unknown } | undefined) => Promise<unknown>;
    };

    findUserForCredentialsMock.mockReset();
    verifyPasswordMock.mockReset();

    expect(await providerOptions.authorize(undefined)).toBeNull();
    expect(findUserForCredentialsMock).not.toHaveBeenCalled();
    expect(verifyPasswordMock).not.toHaveBeenCalled();

    expect(
      await providerOptions.authorize({
        email: "   ",
        password: "   "
      })
    ).toBeNull();
    expect(findUserForCredentialsMock).not.toHaveBeenCalled();
    expect(verifyPasswordMock).not.toHaveBeenCalled();

    findUserForCredentialsMock.mockResolvedValueOnce(null);
    expect(
      await providerOptions.authorize({
        email: "missing@example.com",
        password: "StrongPassword123"
      })
    ).toBeNull();
    expect(verifyPasswordMock).not.toHaveBeenCalled();

    findUserForCredentialsMock.mockResolvedValueOnce({
      id: "inactive-user",
      email: "inactive@example.com",
      name: "Inactive",
      role: "user",
      passwordHash: "hashed-password",
      isActive: false
    });
    expect(
      await providerOptions.authorize({
        email: "inactive@example.com",
        password: "StrongPassword123"
      })
    ).toBeNull();
    expect(verifyPasswordMock).not.toHaveBeenCalled();

    findUserForCredentialsMock.mockResolvedValueOnce({
      id: "wrong-password-user",
      email: "wrong@example.com",
      name: "Wrong Password",
      role: "user",
      passwordHash: "hashed-password",
      isActive: true
    });
    verifyPasswordMock.mockResolvedValueOnce(false);
    expect(
      await providerOptions.authorize({
        email: "wrong@example.com",
        password: "WrongPassword123"
      })
    ).toBeNull();

    findUserForCredentialsMock.mockResolvedValueOnce({
      id: "user-1",
      email: "active@example.com",
      name: "Active User",
      role: "admin",
      passwordHash: "valid-hash",
      isActive: true
    });
    verifyPasswordMock.mockResolvedValueOnce(true);

    await expect(
      providerOptions.authorize({
        email: "  ACTIVE@example.com ",
        password: "StrongPassword123"
      })
    ).resolves.toEqual({
      id: "user-1",
      name: "Active User",
      email: "active@example.com",
      role: "admin"
    });

    expect(findUserForCredentialsMock).toHaveBeenCalledWith("active@example.com");
    expect(verifyPasswordMock).toHaveBeenCalledWith("StrongPassword123", "valid-hash");
  });

  it("normalizes role and id into JWT and session callbacks", () => {
    const callbacks = (captured.authConfig as { callbacks: AuthCallbacks }).callbacks;
    const jwtCallback = callbacks.jwt;
    const sessionCallback = callbacks.session;

    expect(jwtCallback({ token: {}, user: { id: "user-1", role: "admin" } })).toMatchObject({
      role: "admin",
      sub: "user-1"
    });
    expect(jwtCallback({ token: { role: "owner" } })).toMatchObject({ role: "user" });
    const sessionWithId = sessionCallback({
      session: { user: { email: "user@example.com" } },
      token: { role: "admin", sub: "user-1" }
    });

    expect(sessionWithId).toMatchObject({
      user: {
        email: "user@example.com",
        id: "user-1",
        role: "admin"
      }
    });
    expect(sessionWithId.user?.id).toBe("user-1");
    expect(sessionWithId.user?.role).toBe("admin");

    // Route guards require id + role on session.user.
    const sessionWithoutSub = sessionCallback({
      session: { user: { email: "user@example.com" } },
      token: { role: "owner" }
    });
    expect(sessionWithoutSub.user?.id).toBe("");
    expect(sessionWithoutSub.user?.role).toBe("user");
  });

  it("resolves auth secret from env with non-production fallback", () => {
    expect(
      resolveAuthSecret({
        AUTH_SECRET: "  top-secret  ",
        NODE_ENV: "development"
      })
    ).toBe("top-secret");
    expect(
      resolveAuthSecret({
        NEXTAUTH_SECRET: "nextauth-secret",
        NODE_ENV: "development"
      })
    ).toBe("nextauth-secret");
    expect(
      resolveAuthSecret({
        NODE_ENV: "development"
      })
    ).toBe("week0-dev-auth-secret-not-for-production");
    expect(
      resolveAuthSecret({
        NODE_ENV: "production"
      })
    ).toBeUndefined();
  });
});
