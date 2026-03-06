import Link from "next/link";
import { getNavigationForRole, type AppRole } from "../../lib/navigation";

type AppNavigationProps = Readonly<{
  role: AppRole;
}>;

export function AppNavigation({ role }: AppNavigationProps) {
  const navigationItems = getNavigationForRole(role);

  return (
    <nav aria-label="Primary navigation">
      <ul className="app-nav">
        {navigationItems.map((item) => (
          <li key={item.key}>
            <Link className="app-nav__link" href={item.href}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
