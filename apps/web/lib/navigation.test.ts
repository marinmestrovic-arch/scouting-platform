import { describe, expect, it } from "vitest";
import {
  APP_ROLES,
  APP_NAVIGATION_GROUPS,
  APP_NAVIGATION_ITEMS,
  getCsvExportBatchResultHref,
  getNavigationGroupLabel,
  getHubspotPushBatchResultHref,
  getNavigationForRole,
  isAppRole,
  isNavItemVisibleToRole,
  resolveAppRole
} from "./navigation";

describe("navigation config", () => {
  it("defines dashboard, new scouting, database, and admin entries", () => {
    expect(APP_NAVIGATION_ITEMS.map((item) => item.key)).toEqual([
      "dashboard",
      "new-scouting",
      "database",
      "admin",
    ]);
    expect(APP_NAVIGATION_GROUPS.map((group) => group.key)).toEqual(["workspace", "admin"]);
    expect(APP_ROLES).toEqual(["admin", "user"]);
  });

  it("keeps hrefs aligned with each workspace route", () => {
    expect(APP_NAVIGATION_ITEMS.map((item) => item.href)).toEqual([
      "/dashboard",
      "/new-scouting",
      "/database",
      "/admin",
    ]);
  });

  it("stores role visibility metadata per entry", () => {
    const adminEntry = APP_NAVIGATION_ITEMS.find((item) => item.key === "admin");
    const databaseEntry = APP_NAVIGATION_ITEMS.find((item) => item.key === "database");
    const adminOnlyEntry = APP_NAVIGATION_ITEMS.find((item) => item.key === "admin");

    expect(databaseEntry).toBeDefined();
    expect(adminOnlyEntry).toBeDefined();
    expect(adminEntry?.visibleTo).toEqual(["admin"]);
    expect(adminEntry?.group).toBe("admin");
    expect(isNavItemVisibleToRole(databaseEntry!, "user")).toBe(true);
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
      "database",
    ]);
    expect(getNavigationForRole("admin").map((item) => item.key)).toEqual([
      "dashboard",
      "new-scouting",
      "database",
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

  it("validates and resolves known roles", () => {
    expect(isAppRole("admin")).toBe(true);
    expect(isAppRole("user")).toBe(true);
    expect(isAppRole("owner")).toBe(false);
    expect(resolveAppRole("admin")).toBe("admin");
    expect(resolveAppRole("invalid")).toBe("user");
  });

  it("returns stable group labels", () => {
    expect(getNavigationGroupLabel("workspace")).toBe("Workspace");
    expect(getNavigationGroupLabel("admin")).toBe("Admin");
  });

  it("builds detail routes for export and HubSpot batches", () => {
    expect(getCsvExportBatchResultHref("batch-1")).toBe("/exports/batch-1");
    expect(getHubspotPushBatchResultHref("batch 2")).toBe("/hubspot/batch%202");
  });
});
