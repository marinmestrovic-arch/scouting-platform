import { describe, expect, it } from "vitest";
import {
  APP_NAVIGATION_ITEMS,
  getNavigationForRole,
  isNavItemVisibleToRole
} from "./navigation";

describe("navigation config", () => {
  it("defines catalog, runs, and admin entries", () => {
    expect(APP_NAVIGATION_ITEMS.map((item) => item.key)).toEqual(["catalog", "runs", "admin"]);
  });

  it("keeps hrefs aligned with each navigation key", () => {
    for (const item of APP_NAVIGATION_ITEMS) {
      expect(item.href).toBe(`/${item.key}`);
    }
  });

  it("stores role visibility metadata per entry", () => {
    const adminEntry = APP_NAVIGATION_ITEMS.find((item) => item.key === "admin");
    const catalogEntry = APP_NAVIGATION_ITEMS.find((item) => item.key === "catalog");
    const adminOnlyEntry = APP_NAVIGATION_ITEMS.find((item) => item.key === "admin");

    expect(catalogEntry).toBeDefined();
    expect(adminOnlyEntry).toBeDefined();
    expect(adminEntry?.visibleTo).toEqual(["admin"]);
    expect(isNavItemVisibleToRole(catalogEntry!, "user")).toBe(true);
    expect(isNavItemVisibleToRole(adminOnlyEntry!, "user")).toBe(false);
  });

  it("matches role visibility metadata and helper behavior for each role", () => {
    for (const item of APP_NAVIGATION_ITEMS) {
      expect(isNavItemVisibleToRole(item, "user")).toBe(item.visibleTo.includes("user"));
      expect(isNavItemVisibleToRole(item, "admin")).toBe(item.visibleTo.includes("admin"));
    }
  });

  it("returns only entries visible to a role", () => {
    expect(getNavigationForRole("user").map((item) => item.key)).toEqual(["catalog", "runs"]);
    expect(getNavigationForRole("admin").map((item) => item.key)).toEqual([
      "catalog",
      "runs",
      "admin"
    ]);
  });

  it("preserves global item order after role filtering", () => {
    const globalOrder = APP_NAVIGATION_ITEMS.map((item) => item.key);

    expect(getNavigationForRole("user").map((item) => item.key)).toEqual(
      globalOrder.filter((key) => key !== "admin")
    );
    expect(getNavigationForRole("admin").map((item) => item.key)).toEqual(globalOrder);
  });
});
