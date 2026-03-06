import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_TITLE } from "../../lib/shell";
import LoginPage from "./page";

describe("login page scaffold", () => {
  it("renders the Auth.js login UI shell", () => {
    const html = renderToStaticMarkup(LoginPage());

    expect(html).toContain("Week 0 Auth.js UI Scaffold");
    expect(html).toContain(`<h1>${APP_TITLE}</h1>`);
    expect(html).toContain("Demo credentials:");
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain("Sign in");
  });
});
