import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("global design tokens and shell styles", () => {
  it("defines core color, spacing, and typography tokens", () => {
    expect(css).toContain("--color-canvas:");
    expect(css).toContain("--color-surface:");
    expect(css).toContain("--color-border:");
    expect(css).toContain("--space-6:");
    expect(css).toContain("--space-10:");
    expect(css).toContain("--font-family-sans:");
    expect(css).toContain("--font-size-500:");
    expect(css).toContain("--radius-lg:");
  });

  it("keeps authenticated shell and nav class contracts", () => {
    expect(css).toContain(".auth-shell");
    expect(css).toContain(".auth-shell__header");
    expect(css).toContain(".auth-shell__content");
    expect(css).toContain(".auth-shell__signout");
    expect(css).toContain(".app-nav");
    expect(css).toContain(".app-nav__link");
  });

  it("includes login form state styles", () => {
    expect(css).toContain(".login-page");
    expect(css).toContain(".login-form");
    expect(css).toContain(".login-form__status--idle");
    expect(css).toContain(".login-form__status--submitting");
    expect(css).toContain(".login-form__status--error");
  });
});
