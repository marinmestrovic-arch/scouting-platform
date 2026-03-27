import React from "react";

import { listRecentRuns } from "@scouting-platform/core";
import { auth } from "../../../auth";
import { DashboardWorkspace } from "../../../components/dashboard/dashboard-workspace";
import { PageSection } from "../../../components/layout/page-section";
import { getRoleFromSession } from "../../../lib/access-control";

export default async function DashboardPage() {
  const session = await auth();
  const role = getRoleFromSession(session);
  const initialData =
    session?.user?.id
      ? await listRecentRuns({
          userId: session.user.id,
          role,
          limit: 50,
        })
      : undefined;

  return (
    <PageSection
      title="Dashboard"
      description="Review recent scouting runs, track coverage against each run target, and hand each run off to Database, CSV export, or HubSpot from one compact table."
    >
      <DashboardWorkspace
        initialData={initialData}
        initialFilters={{
          campaignManagerUserId: "",
          client: "",
          market: "",
        }}
      />
    </PageSection>
  );
}
