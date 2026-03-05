import { describe, expect, it, vi } from "vitest";
import { getWeek0DemoCredentialsFromEnv } from "./lib/auth-flow";

const {
  captured,
  nextAuthFactoryMock,
  credentialsProviderMock,
  nextAuthExports
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
    nextAuthExports
  };
});

vi.mock("next-auth", () => ({
  default: nextAuthFactoryMock
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: credentialsProviderMock
}));

import { authConfig, auth, handlers, signIn, signOut } from "./auth";

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

  it("authorizes only configured demo credentials for Week 0 scaffold", () => {
    const providerOptions = captured.credentialsOptions as {
      authorize: (credentials: { email?: string; password?: string } | undefined) => unknown;
    };
    const demoCredentials = getWeek0DemoCredentialsFromEnv();

    expect(providerOptions.authorize?.(undefined)).toBeNull();
    expect(
      providerOptions.authorize({
        email: demoCredentials.email,
        password: "wrong-password"
      })
    ).toBeNull();
    expect(
      providerOptions.authorize({
        email: demoCredentials.email,
        password: demoCredentials.password
      })
    ).toEqual({
      id: "week0-demo-user",
      name: "Week 0 User",
      email: demoCredentials.email
    });
  });
});
