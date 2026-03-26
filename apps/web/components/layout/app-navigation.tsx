"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { getNavigationForRole, type AppRole } from "../../lib/navigation";

type AppNavigationProps = Readonly<{
  role: AppRole;
}>;

export function AppNavigation({ role }: AppNavigationProps) {
  const pathname = usePathname();
  const navigationItems = getNavigationForRole(role);

  return (
    <nav aria-label="Primary navigation" className="app-nav">
      <ul className="app-nav__list">
        {navigationItems.map((item) => (
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
    </nav>
  );
}
