export const APP_ROLES = ["admin", "user"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export type AppNavigationKey =
  | "dashboard"
  | "new-scouting"
  | "catalog"
  | "database"
  | "feedback"
  | "admin";

export type AppNavigationItem = Readonly<{
  key: AppNavigationKey;
  href:
    | "/dashboard"
    | "/new-scouting"
    | "/catalog"
    | "/database"
    | "/feedback"
    | "/admin";
  label: string;
  visibleTo: readonly AppRole[];
}>;

export const APP_NAVIGATION_ITEMS: readonly AppNavigationItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    visibleTo: ["user", "admin"]
  },
  {
    key: "new-scouting",
    label: "New Scouting",
    href: "/new-scouting",
    visibleTo: ["user", "admin"]
  },
  {
    key: "catalog",
    label: "Catalog",
    href: "/catalog",
    visibleTo: ["user", "admin"]
  },
  {
    key: "database",
    label: "Database",
    href: "/database",
    visibleTo: ["user", "admin"]
  },
  {
    key: "feedback",
    label: "Feedback",
    href: "/feedback",
    visibleTo: ["user", "admin"]
  },
  {
    key: "admin",
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

export function getCsvExportBatchResultHref(batchId: string): string {
  return `/exports/${encodeURIComponent(batchId)}`;
}

export function getExportPreviewHref(runId: string): string {
  return `/exports/prepare/${encodeURIComponent(runId)}`;
}
