import React from "react";
import { PageSection } from "../../../components/layout/page-section";
import {
  SkeletonPageBody,
  SkeletonTable,
} from "../../../components/ui/skeleton";

export default function HubspotLoading() {
  return (
    <PageSection
      title="HubSpot"
      description="Review Week 7 import-ready CSV batches, inspect missing-field failures, and keep legacy Week 6 push history readable without leaving the authenticated workspace."
    >
      <SkeletonPageBody>
        <SkeletonTable columns={5} rows={4} />
      </SkeletonPageBody>
    </PageSection>
  );
}
