import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOGIN_CREDENTIALS_ERROR_MESSAGE,
  LOGIN_GENERIC_ERROR_MESSAGE,
  LOGIN_INITIAL_STATE
} from "../../lib/auth-flow";
import { signInWithCredentials } from "./actions";

const { signInMock } = vi.hoisted(() => ({
  signInMock: vi.fn()
}));

vi.mock("../../auth", () => ({
  signIn: signInMock
}));

function createFormData(values: Readonly<Record<string, string | Blob>>): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(values)) {
    formData.append(key, value);
  }

  return formData;
}

function createRedirectError(): Error & { digest: string } {
  const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
  error.digest = "NEXT_REDIRECT;replace;/catalog;303;";
  return error;
}

describe("login actions", () => {
  beforeEach(() => {
    signInMock.mockReset();
  });

  it("submits credentials sign-in with catalog redirect on success", async () => {
    signInMock.mockResolvedValue(undefined);

    const result = await signInWithCredentials(
      LOGIN_INITIAL_STATE,
      createFormData({
        email: "active@example.com",
        password: "StrongPassword123"
      })
    );

    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "active@example.com",
      password: "StrongPassword123",
      redirectTo: "/catalog"
    });
    expect(result).toEqual(LOGIN_INITIAL_STATE);
  });

  it("handles non-string form values safely", async () => {
    signInMock.mockResolvedValue(undefined);

    await signInWithCredentials(
      LOGIN_INITIAL_STATE,
      createFormData({
        email: new Blob(["active@example.com"]),
        password: new Blob(["StrongPassword123"])
      })
    );

    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "",
      password: "",
      redirectTo: "/catalog"
    });
  });

  it("returns credentials-safe error copy for CredentialsSignin", async () => {
    signInMock.mockRejectedValue({
      type: "CredentialsSignin"
    });

    const result = await signInWithCredentials(
      LOGIN_INITIAL_STATE,
      createFormData({
        email: "active@example.com",
        password: "bad-password"
      })
    );

    expect(result).toEqual({
      status: "error",
      message: LOGIN_CREDENTIALS_ERROR_MESSAGE
    });
  });

  it("returns generic error copy for known non-credentials auth errors", async () => {
    signInMock.mockRejectedValue({
      type: "CallbackRouteError"
    });

    const result = await signInWithCredentials(
      LOGIN_INITIAL_STATE,
      createFormData({
        email: "active@example.com",
        password: "StrongPassword123"
      })
    );

    expect(result).toEqual({
      status: "error",
      message: LOGIN_GENERIC_ERROR_MESSAGE
    });
  });

  it("rethrows non-auth errors so Next.js redirect and runtime errors are preserved", async () => {
    const redirectError = createRedirectError();
    signInMock.mockRejectedValue(redirectError);

    await expect(
      signInWithCredentials(
        LOGIN_INITIAL_STATE,
        createFormData({
          email: "active@example.com",
          password: "StrongPassword123"
        })
      )
    ).rejects.toBe(redirectError);
  });
});
