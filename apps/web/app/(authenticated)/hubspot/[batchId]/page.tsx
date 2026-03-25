import { HubspotPushBatchResultShell } from "../../../../components/hubspot/hubspot-push-batch-result-shell";
import { PageSection } from "../../../../components/layout/page-section";

type HubspotBatchResultPageProps = Readonly<{
  params: Promise<{ batchId: string }>;
}>;

export default async function HubspotBatchResultPage({ params }: HubspotBatchResultPageProps) {
  const { batchId } = await params;

  return (
    <PageSection
      title="HubSpot Batch Result"
      description="Review stored row outcomes, visible failures, CSV readiness, and legacy fallback detail for a single HubSpot batch."
    >
      <HubspotPushBatchResultShell batchId={batchId} />
    </PageSection>
  );
}
