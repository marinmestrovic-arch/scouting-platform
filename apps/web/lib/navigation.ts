export const APP_ROLES = ["admin", "user"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const APP_NAVIGATION_GROUPS = [
  {
    key: "workspace",
    label: "Workspace",
  },
  {
    key: "admin",
    label: "Admin",
  },
] as const;

export type AppNavigationGroupKey = (typeof APP_NAVIGATION_GROUPS)[number]["key"];
export type AppNavigationKey =
  | "dashboard"
  | "new-scouting"
  | "catalog"
  | "database"
  | "admin";

export type AppNavigationItem = Readonly<{
  key: AppNavigationKey;
  group: AppNavigationGroupKey;
  href:
    | "/dashboard"
    | "/new-scouting"
    | "/catalog"
    | "/database"
    | "/admin";
  label: string;
  visibleTo: readonly AppRole[];
}>;

export const APP_NAVIGATION_ITEMS: readonly AppNavigationItem[] = [
  {
    key: "dashboard",
    group: "workspace",
    label: "Dashboard",
    href: "/dashboard",
    visibleTo: ["user", "admin"]
  },
  {
    key: "new-scouting",
    group: "workspace",
    label: "New scouting",
    href: "/new-scouting",
    visibleTo: ["user", "admin"]
  },
  {
    key: "catalog",
    group: "workspace",
    label: "Catalog",
    href: "/catalog",
    visibleTo: ["user", "admin"]
  },
  {
    key: "database",
    group: "workspace",
    label: "Database",
    href: "/database",
    visibleTo: ["user", "admin"]
  },
  {
    key: "admin",
    group: "admin",
    label: "Admin",
    href: "/admin",
    visibleTo: ["admin"]
  }
] as const;

export function isAppRole(value: unknown): value is AppRole {
  return APP_ROLES.some((role) => role === value);
}

export function resolveAppRole(value: unknown, fallback: AppRole = "user"): AppRole {
  if (isAppRole(value)) {
    return value;
  }

  return fallback;
}

export function isNavItemVisibleToRole(item: AppNavigationItem, role: AppRole): boolean {
  return item.visibleTo.includes(role);
}

export function getNavigationForRole(role: AppRole): AppNavigationItem[] {
  return APP_NAVIGATION_ITEMS.filter((item) => isNavItemVisibleToRole(item, role));
}

export function getNavigationGroupLabel(group: AppNavigationGroupKey): string {
  return APP_NAVIGATION_GROUPS.find((item) => item.key === group)?.label ?? group;
}

export function getCsvExportBatchResultHref(batchId: string): string {
  return `/exports/${encodeURIComponent(batchId)}`;
}

export function getHubspotPushBatchResultHref(batchId: string): string {
  return `/hubspot/${encodeURIComponent(batchId)}`;
}

export function getHubspotPreviewHref(runId: string): string {
  return `/hubspot/prepare/${encodeURIComponent(runId)}`;
}

export function getCsvPreviewHref(runId: string): string {
  return `/exports/prepare/${encodeURIComponent(runId)}`;
}
