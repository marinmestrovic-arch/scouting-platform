import React from "react";

import { HubspotPushManager } from "../../../components/hubspot/hubspot-push-manager";
import { PageSection } from "../../../components/layout/page-section";

export default function HubspotPage() {
  return (
    <PageSection
      title="HubSpot"
      description="Review selected creator push batches, inspect row failures, and track background HubSpot delivery without leaving the authenticated workspace."
    >
      <HubspotPushManager />
    </PageSection>
  );
}
