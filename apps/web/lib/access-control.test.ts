import { describe, expect, it } from "vitest";
import { canAccessNavigationKey, FORBIDDEN_ROUTE, getRoleFromSession, LOGIN_ROUTE } from "./access-control";

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

  it("maps unknown or missing session role to user fallback", () => {
    expect(getRoleFromSession(null)).toBe("user");
    expect(getRoleFromSession({ user: { role: "admin" } } as never)).toBe("admin");
    expect(getRoleFromSession({ user: { role: "owner" } } as never)).toBe("user");
  });

  it("exports route constants for auth redirects", () => {
    expect(LOGIN_ROUTE).toBe("/login");
    expect(FORBIDDEN_ROUTE).toBe("/forbidden");
  });
});
