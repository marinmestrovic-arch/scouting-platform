import React from "react";
import Link from "next/link";
import {
  APP_NAVIGATION_GROUPS,
  getNavigationForRole,
  getNavigationGroupLabel,
  type AppRole,
} from "../../lib/navigation";

type AppNavigationProps = Readonly<{
  role: AppRole;
}>;

export function AppNavigation({ role }: AppNavigationProps) {
  const navigationItems = getNavigationForRole(role);

  return (
    <nav aria-label="Primary navigation">
      <div className="app-nav">
        {APP_NAVIGATION_GROUPS.map((group) => {
          const items = navigationItems.filter((item) => item.group === group.key);

          if (items.length === 0) {
            return null;
          }

          return (
            <section className="app-nav__group" key={group.key}>
              <p className="app-nav__group-label">{getNavigationGroupLabel(group.key)}</p>
              <ul className="app-nav__group-list">
                {items.map((item) => (
                  <li key={item.key}>
                    <Link className="app-nav__link" href={item.href}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </nav>
  );
}
