import { describe, expect, it } from "vitest";
import {
  getAuthErrorMessage,
  getWeek0DemoCredentialsFromEnv,
  getWeek0DemoRoleFromEnv,
  isWeek0DemoCredentialsMatch,
  LOGIN_CREDENTIALS_ERROR_MESSAGE,
  LOGIN_GENERIC_ERROR_MESSAGE,
  LOGIN_IDLE_MESSAGE,
  LOGIN_INITIAL_STATE,
  LOGIN_SUBMITTING_MESSAGE,
  resolveLoginUiState,
  WEEK0_DEMO_EMAIL_FALLBACK,
  WEEK0_DEMO_PASSWORD_FALLBACK,
  WEEK0_DEMO_ROLE_FALLBACK
} from "./auth-flow";

describe("auth flow scaffold helpers", () => {
  it("falls back to default demo credentials when env vars are missing", () => {
    expect(getWeek0DemoCredentialsFromEnv({})).toEqual({
      email: WEEK0_DEMO_EMAIL_FALLBACK,
      password: WEEK0_DEMO_PASSWORD_FALLBACK
    });
  });

  it("uses env-provided demo credentials when available", () => {
    expect(
      getWeek0DemoCredentialsFromEnv({
        AUTH_DEMO_EMAIL: "agent@example.com",
        AUTH_DEMO_PASSWORD: "agent-pass"
      })
    ).toEqual({
      email: "agent@example.com",
      password: "agent-pass"
    });
  });

  it("resolves role from env with user fallback", () => {
    expect(getWeek0DemoRoleFromEnv({})).toBe(WEEK0_DEMO_ROLE_FALLBACK);
    expect(getWeek0DemoRoleFromEnv({ AUTH_DEMO_ROLE: "admin" })).toBe("admin");
    expect(getWeek0DemoRoleFromEnv({ AUTH_DEMO_ROLE: "unexpected" })).toBe(WEEK0_DEMO_ROLE_FALLBACK);
  });

  it("matches sign-in attempts against configured demo credentials", () => {
    const env = {
      AUTH_DEMO_EMAIL: "demo@example.com",
      AUTH_DEMO_PASSWORD: "demo-secret"
    };

    expect(isWeek0DemoCredentialsMatch("demo@example.com", "demo-secret", env)).toBe(true);
    expect(isWeek0DemoCredentialsMatch("demo@example.com", "wrong-secret", env)).toBe(false);
  });

  it("resolves idle, submitting, and error login UI states", () => {
    expect(resolveLoginUiState(false, LOGIN_INITIAL_STATE)).toEqual({
      status: "idle",
      message: LOGIN_IDLE_MESSAGE
    });

    expect(resolveLoginUiState(true, LOGIN_INITIAL_STATE)).toEqual({
      status: "submitting",
      message: LOGIN_SUBMITTING_MESSAGE
    });

    expect(
      resolveLoginUiState(false, {
        status: "error",
        message: LOGIN_CREDENTIALS_ERROR_MESSAGE
      })
    ).toEqual({
      status: "error",
      message: LOGIN_CREDENTIALS_ERROR_MESSAGE
    });
  });

  it("maps Auth.js error types to UI-safe text", () => {
    expect(getAuthErrorMessage("CredentialsSignin")).toBe(LOGIN_CREDENTIALS_ERROR_MESSAGE);
    expect(getAuthErrorMessage("CallbackRouteError")).toBe(LOGIN_GENERIC_ERROR_MESSAGE);
  });
});
