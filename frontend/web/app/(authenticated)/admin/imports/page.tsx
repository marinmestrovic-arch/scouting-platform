import { auth } from "../../../../auth";
import { AdminCsvImportManager } from "../../../../components/admin/admin-csv-import-manager";
import { PageSection } from "../../../../components/layout/page-section";
import {
  canAccessNavigationKey,
  FORBIDDEN_ROUTE,
  getRoleFromSession,
  LOGIN_ROUTE,
} from "../../../../lib/access-control";
import { redirect } from "next/navigation";

export default async function AdminImportsPage() {
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
      section="Admin"
      title="CSV Imports"
      description="Upload strict-template CSV batches and inspect row-level results without leaving the admin workspace."
    >
      <AdminCsvImportManager />
    </PageSection>
  );
}
