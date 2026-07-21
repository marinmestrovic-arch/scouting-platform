import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_TITLE } from "../../lib/shell";
import LoginPage from "./page";

describe("login page", () => {
  it("renders login copy and form fields without marketing pitch", () => {
    const html = renderToStaticMarkup(LoginPage());

    expect(html).toContain(`<h1>${APP_TITLE}</h1>`);
    expect(html).toContain("Sign in to Atlas to start a scouting run.");
    expect(html).toContain(`type="email"`);
    expect(html).toContain(`type="password"`);
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Internal access");
    expect(html).not.toContain("cockpit");
    expect(html).not.toContain("Plan briefs");
    expect(html).not.toContain("200k+");
  });
});
