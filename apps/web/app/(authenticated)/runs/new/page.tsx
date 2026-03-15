import { PageSection } from "../../../../components/layout/page-section";
import { NewScoutingWorkspace } from "../../../../components/scouting/new-scouting-workspace";

export default function NewRunPage() {
  return (
    <PageSection
      title="New scouting"
      description="Legacy shortcut to the new scouting workspace. Only the prompt is live today while the remaining planning controls stay visible as disabled scaffolds."
    >
      <NewScoutingWorkspace showLegacyNotice />
    </PageSection>
  );
}
