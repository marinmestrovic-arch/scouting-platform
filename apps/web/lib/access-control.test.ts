import { describe, expect, it } from "vitest";
import { canAccessNavigationKey } from "./access-control";

describe("access control", () => {
  it("allows admin route only for admin role", () => {
    expect(canAccessNavigationKey("admin", "admin")).toBe(true);
    expect(canAccessNavigationKey("admin", "user")).toBe(false);
  });

  it("allows shared routes for both roles", () => {
    expect(canAccessNavigationKey("catalog", "user")).toBe(true);
    expect(canAccessNavigationKey("catalog", "admin")).toBe(true);
    expect(canAccessNavigationKey("runs", "user")).toBe(true);
    expect(canAccessNavigationKey("runs", "admin")).toBe(true);
  });
});
