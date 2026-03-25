import React from "react";

import { HubspotPushManager } from "../../../components/hubspot/hubspot-push-manager";
import { PageSection } from "../../../components/layout/page-section";

export default function HubspotPage() {
  return (
    <PageSection
      title="HubSpot"
      description="Review Week 7 import-ready CSV batches, inspect missing-field failures, and keep legacy Week 6 push history readable without leaving the authenticated workspace."
    >
      <HubspotPushManager />
    </PageSection>
  );
}
