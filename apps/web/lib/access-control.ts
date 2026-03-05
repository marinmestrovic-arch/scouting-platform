import { APP_NAVIGATION_ITEMS, type AppNavigationKey, type AppRole } from "./navigation";

export function canAccessNavigationKey(key: AppNavigationKey, role: AppRole): boolean {
  const item = APP_NAVIGATION_ITEMS.find((navigationItem) => navigationItem.key === key);

  if (!item) {
    return false;
  }

  return item.visibleTo.includes(role);
}
