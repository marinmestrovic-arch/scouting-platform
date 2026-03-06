"use client";

import { useActionState } from "react";
import { signInWithCredentials } from "../../app/login/actions";
import { LOGIN_INITIAL_STATE, resolveLoginUiState, type LoginActionState } from "../../lib/auth-flow";

const EMPTY_FORM_STATE: LoginActionState = LOGIN_INITIAL_STATE;

export function LoginForm() {
  const [actionState, formAction, isSubmitting] = useActionState(
    signInWithCredentials,
    EMPTY_FORM_STATE
  );
  const uiState = resolveLoginUiState(isSubmitting, actionState);

  return (
    <form action={formAction} className="login-form" noValidate suppressHydrationWarning>
      <label className="login-form__field">
        <span>Email</span>
        <input autoComplete="email" name="email" required suppressHydrationWarning type="email" />
      </label>
      <label className="login-form__field">
        <span>Password</span>
        <input
          autoComplete="current-password"
          name="password"
          required
          suppressHydrationWarning
          type="password"
        />
      </label>
      <p
        aria-live="polite"
        className={`login-form__status login-form__status--${uiState.status}`}
        role={uiState.status === "error" ? "alert" : undefined}
      >
        {uiState.message}
      </p>
      <button
        className="login-form__submit"
        disabled={isSubmitting}
        suppressHydrationWarning
        type="submit"
      >
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
