import React from "react";

import { DashboardWorkspace } from "../../../components/dashboard/dashboard-workspace";
import { PageSection } from "../../../components/layout/page-section";

export default function DashboardPage() {
  return (
    <PageSection
      title="Dashboard"
      description="Review recent scouting runs, track coverage against each run target, and hand each run off to Database, CSV export, or HubSpot from one compact table."
    >
      <DashboardWorkspace />
    </PageSection>
  );
}
