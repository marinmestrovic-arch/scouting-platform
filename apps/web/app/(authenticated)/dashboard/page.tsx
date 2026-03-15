import React from "react";

import { DashboardWorkspace } from "../../../components/dashboard/dashboard-workspace";
import { PageSection } from "../../../components/layout/page-section";

export default function DashboardPage() {
  return (
    <PageSection
      title="Dashboard"
      description="Review recent scouting runs, keep weekly planning scaffolds visible, and hand each run off to Database, CSV export, or HubSpot from one board."
    >
      <DashboardWorkspace />
    </PageSection>
  );
}
