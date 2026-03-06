import { PageSection } from "../../../components/layout/page-section";
import { RouteScaffoldList } from "../../../components/layout/route-scaffold-list";

export default function RunsPage() {
  return (
    <PageSection
      title="Runs"
      description="Run creation, status, and result UX lands in Week 3."
    >
      <RouteScaffoldList
        heading="Week 3 shell paths"
        paths={["/runs", "/runs/new", "/runs/[runId]"]}
      />
    </PageSection>
  );
}
