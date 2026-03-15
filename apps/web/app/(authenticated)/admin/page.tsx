import React from "react";
import { auth } from "../../../auth";
import { AdminDashboardShell } from "../../../components/admin/admin-dashboard-shell";
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
      description="Triage admin-only work, catch setup gaps early, and jump into catalog, export, HubSpot, or the full HypeAuditor queue from one workspace."
    >
      <div className="admin-page__stack">
        <AdminDashboardShell />
        <div className="admin-page__queue" id="admin-approval-queue">
          <AdminAdvancedReportQueue />
        </div>
      </div>
    </PageSection>
  );
}
