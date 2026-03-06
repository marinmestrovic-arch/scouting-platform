import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { APP_TITLE } from "../lib/shell";
import RootLayout, { metadata } from "./layout";
import HomePage from "./page";

describe("week 0 bootstrap baseline", () => {
  it("renders the app entry shell", () => {
    const html = renderToStaticMarkup(HomePage());

    expect(html).toContain(`<h1>${APP_TITLE}</h1>`);
    expect(html).toContain("Week 0 scaffold is ready.");
  });

  it("keeps root layout metadata and language stable", () => {
    expect(metadata.title).toBe(APP_TITLE);
    expect(metadata.description).toBe("Internal creator scouting platform.");

    const html = renderToStaticMarkup(RootLayout({ children: "bootstrap" }));

    expect(html).toContain('lang="en"');
    expect(html).toContain("bootstrap");
  });

  it("exports web transpile package config", () => {
    expect(nextConfig).toMatchObject({
      transpilePackages: [
        "@scouting-platform/contracts",
        "@scouting-platform/core",
        "@scouting-platform/db"
      ]
    });
  });
});
