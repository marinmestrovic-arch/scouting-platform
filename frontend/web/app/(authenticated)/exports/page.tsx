import React from "react";
import { redirect } from "next/navigation";

import { CsvExportManager } from "../../../components/exports/csv-export-manager";
import { PageHeader } from "../../../components/layout/PageHeader";
import { getSession } from "../../../lib/cached-auth";
import { FORBIDDEN_ROUTE, getRoleFromSession, LOGIN_ROUTE } from "../../../lib/access-control";

export default async function ExportsPage() {
  const session = await getSession();

  if (!session?.user) {
    redirect(LOGIN_ROUTE);
  }

  if (getRoleFromSession(session) !== "admin") {
    redirect(FORBIDDEN_ROUTE);
  }

  return (
    <section className="page-section">
      <PageHeader crumbs={[{ label: "Exports" }]} title="Exports" />
      <div className="page-container page-section__body">
        <CsvExportManager />
      </div>
    </section>
  );
}
