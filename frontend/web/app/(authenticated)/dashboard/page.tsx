import React, { Suspense } from "react";

import { getSession } from "../../../lib/cached-auth";
import { getCachedRecentRuns } from "../../../lib/cached-data";
import { DashboardWorkspace } from "../../../components/dashboard/dashboard-workspace";
import { PageHeader } from "../../../components/layout/PageHeader";
import { SkeletonFilterBar, SkeletonPageBody, SkeletonTable, Skeleton } from "../../../components/ui/skeleton";
import { getRoleFromSession } from "../../../lib/access-control";

const DASHBOARD_DESCRIPTION =
  "Review recent scouting runs, track coverage against each run target, and hand each run off to Database, CSV export, or Google Sheets from one compact table.";

async function DashboardData() {
  const session = await getSession();
  const role = getRoleFromSession(session);
  const initialData =
    session?.user?.id
      ? await getCachedRecentRuns({
          userId: session.user.id,
          role,
          limit: 50,
        })
      : undefined;

  return (
    <DashboardWorkspace
      initialData={initialData}
      initialFilters={{
        campaignManagerUserId: "",
        client: "",
        market: "",
      }}
    />
  );
}

function DashboardFallback() {
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard" }]}
        description={DASHBOARD_DESCRIPTION}
        title="Dashboard"
      />
      <div className="page-container page-section__body">
        <SkeletonPageBody>
          <SkeletonFilterBar filters={3} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Skeleton borderRadius="var(--radius-md)" height="2rem" width="9rem" />
          </div>
          <SkeletonTable columns={9} rows={6} />
        </SkeletonPageBody>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <section className="page-section">
      <Suspense fallback={<DashboardFallback />}>
        <DashboardData />
      </Suspense>
    </section>
  );
}
