"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
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
  const pathname = usePathname() ?? "";
  const navigationItems = getNavigationForRole(role);

  return (
    <nav aria-label="Primary navigation" className="app-nav">
      {APP_NAVIGATION_GROUPS.map((group) => {
        const groupItems = navigationItems.filter((item) => item.group === group.key);

        if (groupItems.length === 0) {
          return null;
        }

        return (
          <div className="app-nav__group" key={group.key}>
            <span className="app-nav__group-label">{getNavigationGroupLabel(group.key)}</span>
            <ul className="app-nav__list">
              {groupItems.map((item) => (
                <li key={item.key}>
                  <Link
                    className={
                      pathname === item.href || pathname.startsWith(`${item.href}/`)
                        ? "app-nav__link app-nav__link--active"
                        : "app-nav__link"
                    }
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
