import { describe, expect, it } from "vitest";
import {
  APP_ROLES,
  APP_NAVIGATION_ITEMS,
  getCsvExportBatchResultHref,
  getExportPreviewHref,
  getNavigationForRole,
  isAppRole,
  isNavItemVisibleToRole,
  resolveAppRole
} from "./navigation";

describe("navigation config", () => {
  it("defines dashboard, new scouting, catalog, database, feedback, and admin entries", () => {
    expect(APP_NAVIGATION_ITEMS.map((item) => item.key)).toEqual([
      "dashboard",
      "new-scouting",
      "catalog",
      "database",
      "feedback",
      "admin",
    ]);
    expect(APP_ROLES).toEqual(["admin", "user"]);
  });

  it("keeps hrefs aligned with each workspace route", () => {
    expect(APP_NAVIGATION_ITEMS.map((item) => item.href)).toEqual([
      "/dashboard",
      "/new-scouting",
      "/catalog",
      "/database",
      "/feedback",
      "/admin",
    ]);
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
    expect(getNavigationForRole("user").map((item) => item.key)).toEqual([
      "dashboard",
      "new-scouting",
      "catalog",
      "database",
      "feedback",
    ]);
    expect(getNavigationForRole("admin").map((item) => item.key)).toEqual([
      "dashboard",
      "new-scouting",
      "catalog",
      "database",
      "feedback",
      "admin",
    ]);
  });

  it("preserves global item order after role filtering", () => {
    const globalOrder = APP_NAVIGATION_ITEMS.map((item) => item.key);

    expect(getNavigationForRole("user").map((item) => item.key)).toEqual(
      globalOrder.filter((key) => key !== "admin")
    );
    expect(getNavigationForRole("admin").map((item) => item.key)).toEqual(globalOrder);
  });

  it("validates and resolves known roles", () => {
    expect(isAppRole("admin")).toBe(true);
    expect(isAppRole("user")).toBe(true);
    expect(isAppRole("owner")).toBe(false);
    expect(resolveAppRole("admin")).toBe("admin");
    expect(resolveAppRole("invalid")).toBe("user");
  });

  it("uses the updated title casing for New Scouting", () => {
    const newScoutingEntry = APP_NAVIGATION_ITEMS.find((item) => item.key === "new-scouting");
    expect(newScoutingEntry?.label).toBe("New Scouting");
  });

  it("builds detail routes for exports", () => {
    expect(getCsvExportBatchResultHref("batch-1")).toBe("/exports/batch-1");
    expect(getExportPreviewHref("run 2")).toBe("/exports/prepare/run%202");
  });
});
