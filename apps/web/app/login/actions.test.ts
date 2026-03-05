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

describe("login actions", () => {
  beforeEach(() => {
    signInMock.mockReset();
  });

  it("submits credentials sign-in with catalog redirect on success", async () => {
    signInMock.mockResolvedValue(undefined);

    const result = await signInWithCredentials(
      LOGIN_INITIAL_STATE,
      createFormData({
        email: "demo@scouting.local",
        password: "demo-password"
      })
    );

    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "demo@scouting.local",
      password: "demo-password",
      redirectTo: "/catalog"
    });
    expect(result).toEqual(LOGIN_INITIAL_STATE);
  });

  it("handles non-string form values safely", async () => {
    signInMock.mockResolvedValue(undefined);

    await signInWithCredentials(
      LOGIN_INITIAL_STATE,
      createFormData({
        email: new Blob(["demo@scouting.local"]),
        password: new Blob(["demo-password"])
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
        email: "demo@scouting.local",
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
        email: "demo@scouting.local",
        password: "demo-password"
      })
    );

    expect(result).toEqual({
      status: "error",
      message: LOGIN_GENERIC_ERROR_MESSAGE
    });
  });

  it("falls back to credentials-safe copy when error shape is unknown", async () => {
    signInMock.mockRejectedValue(new Error("unexpected"));

    const result = await signInWithCredentials(
      LOGIN_INITIAL_STATE,
      createFormData({
        email: "demo@scouting.local",
        password: "demo-password"
      })
    );

    expect(result).toEqual({
      status: "error",
      message: LOGIN_CREDENTIALS_ERROR_MESSAGE
    });
  });
});
