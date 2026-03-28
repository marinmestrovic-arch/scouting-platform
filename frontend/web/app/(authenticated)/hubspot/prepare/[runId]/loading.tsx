import React from "react";
import { PageSection } from "../../../../../components/layout/page-section";
import { SkeletonPageBody, SkeletonTable } from "../../../../../components/ui/skeleton";

export default function HubspotPrepareLoading() {
  return (
    <PageSection
      title="HubSpot Preparation"
      description="Review all HubSpot columns, fill required gaps, and export a ready-to-import file."
    >
      <SkeletonPageBody>
        <SkeletonTable columns={8} rows={6} />
      </SkeletonPageBody>
    </PageSection>
  );
}
