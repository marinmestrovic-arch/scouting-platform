import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_TITLE } from "../../lib/shell";
import LoginPage from "./page";

describe("login page", () => {
  it("renders production login copy and form fields", () => {
    const html = renderToStaticMarkup(LoginPage());

    expect(html).toContain("Internal access");
    expect(html).toContain(`<h1>${APP_TITLE}</h1>`);
    expect(html).toContain(
      "Sign in with your assigned work email and password to continue to the catalog."
    );
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Demo credentials:");
    expect(html).not.toContain("Week 0 Auth.js UI Scaffold");
  });
});
