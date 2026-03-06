import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RunsPage from "./page";

describe("runs page", () => {
  it("renders week 3 placeholder with shell paths", () => {
    const html = renderToStaticMarkup(RunsPage());

    expect(html).toContain("Runs");
    expect(html).toContain("Run creation, status, and result UX lands in Week 3.");
    expect(html).toContain("Week 3 shell paths");
    expect(html).toMatch(/<code[^>]*>\/runs<\/code>/);
    expect(html).toContain("/runs/new");
    expect(html).toContain("/runs/[runId]");
  });
});
