import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

import NewRunPage from "./page";

describe("new run page", () => {
  it("redirects to /new-scouting", () => {
    expect(() => NewRunPage()).toThrow("REDIRECT:/new-scouting");
  });
});
