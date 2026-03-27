"use server";

import {
  getAuthErrorMessage,
  LOGIN_INITIAL_STATE,
  type LoginActionState
} from "../../lib/auth-flow";

function getErrorType(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    typeof error.type === "string"
  ) {
    return error.type;
  }

  return null;
}

export async function signInWithCredentials(
  _previousState: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const { signIn } = await import("../../auth");
  const email = formData.get("email");
  const password = formData.get("password");

  try {
    await signIn("credentials", {
      email: typeof email === "string" ? email : "",
      password: typeof password === "string" ? password : "",
      redirectTo: "/dashboard"
    });

    return LOGIN_INITIAL_STATE;
  } catch (error) {
    const errorType = getErrorType(error);

    if (errorType) {
      return {
        status: "error",
        message: getAuthErrorMessage(errorType)
      };
    }

    throw error;
  }
}
