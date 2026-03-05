import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOGIN_CREDENTIALS_ERROR_MESSAGE,
  LOGIN_IDLE_MESSAGE,
  LOGIN_INITIAL_STATE,
  LOGIN_SUBMITTING_MESSAGE,
  type LoginActionState
} from "../../lib/auth-flow";
import { LoginForm } from "./login-form";

const { useActionStateMock } = vi.hoisted(() => ({
  useActionStateMock: vi.fn()
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useActionState: useActionStateMock
  };
});

function mockActionState(actionState: LoginActionState, isSubmitting: boolean) {
  useActionStateMock.mockReturnValue([actionState, vi.fn(), isSubmitting]);
}

describe("login form", () => {
  beforeEach(() => {
    useActionStateMock.mockReset();
  });

  it("renders idle login state by default", () => {
    mockActionState(LOGIN_INITIAL_STATE, false);

    const html = renderToStaticMarkup(createElement(LoginForm));

    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain("Sign in");
    expect(html).toContain(LOGIN_IDLE_MESSAGE);
    expect(html).toContain("login-form__status--idle");
  });

  it("renders submitting state with disabled submit button", () => {
    mockActionState(LOGIN_INITIAL_STATE, true);

    const html = renderToStaticMarkup(createElement(LoginForm));

    expect(html).toContain(LOGIN_SUBMITTING_MESSAGE);
    expect(html).toContain("Signing in...");
    expect(html).toContain("login-form__status--submitting");
    expect(html).toContain("disabled");
  });

  it("renders error state as an alert", () => {
    mockActionState(
      {
        status: "error",
        message: LOGIN_CREDENTIALS_ERROR_MESSAGE
      },
      false
    );

    const html = renderToStaticMarkup(createElement(LoginForm));

    expect(html).toContain(LOGIN_CREDENTIALS_ERROR_MESSAGE);
    expect(html).toContain("login-form__status--error");
    expect(html).toContain('role="alert"');
  });
});
