import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

import RootLayout, { metadata } from "./layout";
import HomePage from "./page";

describe("week 0 bootstrap baseline", () => {
  it("redirects the home page to the dashboard", () => {
    expect(() => HomePage()).toThrow("REDIRECT:/dashboard");
  });

  it("keeps root layout metadata and language stable", () => {
    expect(metadata.title).toBe("Scouting Platform");
    expect(metadata.description).toBe("Creator scouting workspace.");

    const html = renderToStaticMarkup(RootLayout({ children: "bootstrap" }));

    expect(html).toContain(`lang="en"`);
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
