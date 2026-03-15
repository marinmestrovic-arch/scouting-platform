import React from "react";

import { DatabaseWorkspace } from "../../../components/database/database-workspace";
import { PageSection } from "../../../components/layout/page-section";

export default function RunsPage() {
  return (
    <PageSection
      title="Runs"
      description="Legacy shortcut to the Database runs tab. Review stored run snapshots and launch CSV or HubSpot actions from the consolidated database workspace."
    >
      <DatabaseWorkspace forcedTab="runs" showLegacyNotice />
    </PageSection>
  );
}
