import React, { Suspense } from "react";

import { getSession } from "../../../lib/cached-auth";
import { getCachedRecentRuns } from "../../../lib/cached-data";
import { DashboardWorkspace } from "../../../components/dashboard/dashboard-workspace";
import { PageSection } from "../../../components/layout/page-section";
import { SkeletonFilterBar, SkeletonPageBody, SkeletonTable, Skeleton } from "../../../components/ui/skeleton";
import { getRoleFromSession } from "../../../lib/access-control";

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
    <SkeletonPageBody>
      <SkeletonFilterBar filters={3} />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Skeleton borderRadius="var(--radius-md)" height="2rem" width="5rem" />
      </div>
      <SkeletonTable columns={7} rows={6} />
    </SkeletonPageBody>
  );
}

export default function DashboardPage() {
  return (
    <PageSection
      title="Dashboard"
      description="Review recent scouting runs, track coverage against each run target, and hand each run off to Database, CSV export, or HubSpot from one compact table."
    >
      <Suspense fallback={<DashboardFallback />}>
        <DashboardData />
      </Suspense>
    </PageSection>
  );
}
