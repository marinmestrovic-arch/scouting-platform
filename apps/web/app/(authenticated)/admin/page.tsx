import { auth } from "../../../auth";
import { PageSection } from "../../../components/layout/page-section";
import { RouteScaffoldList } from "../../../components/layout/route-scaffold-list";
import {
  canAccessNavigationKey,
  FORBIDDEN_ROUTE,
  getRoleFromSession,
  LOGIN_ROUTE
} from "../../../lib/access-control";
import { redirect } from "next/navigation";

export default async function AdminPage() {
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
      title="Admin"
      description="Admin user management shells start in Week 1. Dashboard and import workflows land in Week 5."
    >
      <RouteScaffoldList
        heading="Week 1 shell paths"
        paths={["/admin", "/admin/users", "/admin/users/[userId]"]}
      />
    </PageSection>
  );
}
