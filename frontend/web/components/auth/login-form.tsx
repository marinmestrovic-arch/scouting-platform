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
      <label className="login-form__field" suppressHydrationWarning>
        <span>Email</span>
        <div className="login-form__control" suppressHydrationWarning>
          <input
            autoComplete="email"
            data-1p-ignore="true"
            data-lpignore="true"
            data-np-autofill="ignore"
            name="email"
            required
            suppressHydrationWarning
            type="email"
          />
        </div>
      </label>
      <label className="login-form__field" suppressHydrationWarning>
        <span>Password</span>
        <div className="login-form__control" suppressHydrationWarning>
          <input
            autoComplete="current-password"
            data-1p-ignore="true"
            data-lpignore="true"
            data-np-autofill="ignore"
            name="password"
            required
            suppressHydrationWarning
            type="password"
          />
        </div>
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
