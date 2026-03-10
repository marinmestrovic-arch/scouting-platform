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

  it("suppresses hydration warnings on the form and button", () => {
    const formElement = SignOutForm();
    const buttonElement = (formElement.props as { children: { props: { suppressHydrationWarning?: boolean } } })
      .children;

    expect((formElement.props as { suppressHydrationWarning?: boolean }).suppressHydrationWarning).toBe(
      true,
    );
    expect(buttonElement.props.suppressHydrationWarning).toBe(true);
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
