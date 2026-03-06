import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ForbiddenPage from "./page";

describe("forbidden page", () => {
  it("shows fallback copy and recovery links", () => {
    const html = renderToStaticMarkup(ForbiddenPage());

    expect(html).toContain("Access restricted");
    expect(html).toContain("You do not have permission to open this page.");
    expect(html).toContain('href="/catalog"');
    expect(html).toContain('href="/login"');
  });
});
