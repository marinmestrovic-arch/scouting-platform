import React from "react";
import { getSession } from "../../../lib/cached-auth";
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
  const session = await getSession();

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
      description="Review approvals, manage users, and keep the dedicated admin workflows within reach."
    >
      <AdminWorkspace />
    </PageSection>
  );
}
