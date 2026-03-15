import React from "react";

import { DatabaseWorkspace } from "../../../components/database/database-workspace";
import { PageSection } from "../../../components/layout/page-section";

export default function DatabasePage() {
  return (
    <PageSection
      title="Database"
      description="Use one workspace for run snapshots and the canonical creator catalog, with export and HubSpot actions available where the shortlist is reviewed."
    >
      <DatabaseWorkspace />
    </PageSection>
  );
}
