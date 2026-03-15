import React from "react";

import { PageSection } from "../../../components/layout/page-section";
import { NewScoutingWorkspace } from "../../../components/scouting/new-scouting-workspace";

export default function NewScoutingPage() {
  return (
    <PageSection
      title="New scouting"
      description="Start a scouting run from the live prompt field while campaign planning controls stay visible as disabled scaffolds for future backend support."
    >
      <NewScoutingWorkspace />
    </PageSection>
  );
}
