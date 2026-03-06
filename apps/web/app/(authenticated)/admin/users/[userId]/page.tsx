import { auth } from "../../../../../auth";
import { PageSection } from "../../../../../components/layout/page-section";
import {
  canAccessNavigationKey,
  FORBIDDEN_ROUTE,
  getRoleFromSession,
  LOGIN_ROUTE
} from "../../../../../lib/access-control";
import { redirect } from "next/navigation";

export default async function AdminUserDetailPage() {
  const session = await auth();

  if (!session?.user) {
    redirect(LOGIN_ROUTE);
    return null;
  }

  if (!canAccessNavigationKey("admin", getRoleFromSession(session))) {
    redirect(FORBIDDEN_ROUTE);
    return null;
  }

  return (
    <PageSection
      title="User Account Detail"
      description="Per-user account and YouTube key state shell lands in Week 1."
    />
  );
}
