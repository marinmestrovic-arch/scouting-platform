export const APP_ROLES = ["admin", "user"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export type AppNavigationKey = "catalog" | "runs" | "exports" | "hubspot" | "admin";

export type AppNavigationItem = Readonly<{
  key: AppNavigationKey;
  label: string;
  href: `/${AppNavigationKey}`;
  visibleTo: readonly AppRole[];
}>;

export const APP_NAVIGATION_ITEMS: readonly AppNavigationItem[] = [
  {
    key: "catalog",
    label: "Catalog",
    href: "/catalog",
    visibleTo: ["user", "admin"]
  },
  {
    key: "runs",
    label: "Runs",
    href: "/runs",
    visibleTo: ["user", "admin"]
  },
  {
    key: "exports",
    label: "Exports",
    href: "/exports",
    visibleTo: ["user", "admin"]
  },
  {
    key: "hubspot",
    label: "HubSpot",
    href: "/hubspot",
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
