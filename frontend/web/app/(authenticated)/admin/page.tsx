import React from "react";
import { auth } from "../../../auth";
import { AdminWorkspace } from "../../../components/admin/admin-workspace";
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
      section="Admin"
      title="Admin"
      description="Triage admin-only work, manage imports, users, and the HypeAuditor approval queue from one workspace."
    >
      <AdminWorkspace />
    </PageSection>
  );
}
