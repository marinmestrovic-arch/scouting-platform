import { auth } from "../../../auth";
import { AdminAdvancedReportQueue } from "../../../components/admin/admin-advanced-report-queue";
import { PageSection } from "../../../components/layout/page-section";
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
      description="Review HypeAuditor approval requests, keep freshness context visible, and route into the existing admin tools."
    >
      <AdminAdvancedReportQueue />
    </PageSection>
  );
}
