import { resolveAppRole, type AppRole } from "./navigation";

export const WEEK0_DEMO_EMAIL_FALLBACK = "demo@scouting.local";
export const WEEK0_DEMO_PASSWORD_FALLBACK = "demo-password";
export const WEEK0_DEMO_ROLE_FALLBACK: AppRole = "user";

export const LOGIN_IDLE_MESSAGE = "Use your assigned work email and password.";
export const LOGIN_SUBMITTING_MESSAGE = "Submitting credentials...";
export const LOGIN_CREDENTIALS_ERROR_MESSAGE = "Invalid email or password.";
export const LOGIN_GENERIC_ERROR_MESSAGE = "Unable to sign in right now. Please try again.";

export type LoginActionState = Readonly<{
  status: "idle" | "error";
  message: string | null;
}>;

export type LoginUiState = Readonly<{
  status: "idle" | "submitting" | "error";
  message: string;
}>;

export const LOGIN_INITIAL_STATE: LoginActionState = {
  status: "idle",
  message: null
};

type EnvVars = Readonly<Record<string, string | undefined>>;

function normalizeCredential(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

export function getWeek0DemoCredentialsFromEnv(
  env: EnvVars = process.env
): Readonly<{ email: string; password: string }> {
  const envEmail = normalizeCredential(env.AUTH_DEMO_EMAIL);
  const envPassword = normalizeCredential(env.AUTH_DEMO_PASSWORD);

  return {
    email: envEmail || WEEK0_DEMO_EMAIL_FALLBACK,
    password: envPassword || WEEK0_DEMO_PASSWORD_FALLBACK
  };
}

export function getWeek0DemoRoleFromEnv(env: EnvVars = process.env): AppRole {
  return resolveAppRole(normalizeCredential(env.AUTH_DEMO_ROLE).toLowerCase(), WEEK0_DEMO_ROLE_FALLBACK);
}

export function isWeek0DemoCredentialsMatch(
  email: unknown,
  password: unknown,
  env: EnvVars = process.env
): boolean {
  const normalizedEmail = normalizeCredential(email);
  const normalizedPassword = normalizeCredential(password);
  const demoCredentials = getWeek0DemoCredentialsFromEnv(env);

  return (
    normalizedEmail.toLowerCase() === demoCredentials.email.toLowerCase() &&
    normalizedPassword === demoCredentials.password
  );
}

export function resolveLoginUiState(
  isSubmitting: boolean,
  actionState: LoginActionState
): LoginUiState {
  if (isSubmitting) {
    return {
      status: "submitting",
      message: LOGIN_SUBMITTING_MESSAGE
    };
  }

  if (actionState.status === "error") {
    return {
      status: "error",
      message: actionState.message ?? LOGIN_GENERIC_ERROR_MESSAGE
    };
  }

  return {
    status: "idle",
    message: LOGIN_IDLE_MESSAGE
  };
}

export function getAuthErrorMessage(errorType: string): string {
  if (errorType === "CredentialsSignin") {
    return LOGIN_CREDENTIALS_ERROR_MESSAGE;
  }

  return LOGIN_GENERIC_ERROR_MESSAGE;
}
