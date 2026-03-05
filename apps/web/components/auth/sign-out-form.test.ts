import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SignOutForm } from "./sign-out-form";

const { signOutMock } = vi.hoisted(() => ({
  signOutMock: vi.fn()
}));

vi.mock("../../auth", () => ({
  signOut: signOutMock
}));

describe("sign out form", () => {
  it("renders sign out button for authenticated shell", () => {
    const html = renderToStaticMarkup(SignOutForm());

    expect(html).toContain('<button class="auth-shell__signout" type="submit">Sign out</button>');
  });

  it("signs out with login redirect when submitted", async () => {
    const formElement = SignOutForm();
    const formAction = (formElement.props as { action: () => Promise<void> }).action;

    await formAction();

    expect(signOutMock).toHaveBeenCalledWith({
      redirectTo: "/login"
    });
  });
});
