import type { Session } from "next-auth";
import { APP_NAVIGATION_ITEMS, resolveAppRole, type AppNavigationKey, type AppRole } from "./navigation";

export const LOGIN_ROUTE = "/login";
export const FORBIDDEN_ROUTE = "/forbidden";

export function canAccessNavigationKey(key: AppNavigationKey, role: AppRole): boolean {
  const item = APP_NAVIGATION_ITEMS.find((navigationItem) => navigationItem.key === key);

  if (!item) {
    return false;
  }

  return item.visibleTo.includes(role);
}

export function getRoleFromSession(session: Session | null): AppRole {
  return resolveAppRole(session?.user?.role);
}
