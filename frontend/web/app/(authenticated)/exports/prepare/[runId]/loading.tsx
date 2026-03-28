import React from "react";
import { PageSection } from "../../../../../components/layout/page-section";
import { SkeletonPageBody, SkeletonTable } from "../../../../../components/ui/skeleton";

export default function ExportPrepareLoading() {
  return (
    <PageSection
      title="CSV Preparation"
      description="Review the full export table and download a CSV directly from the prepared run snapshot."
    >
      <SkeletonPageBody>
        <SkeletonTable columns={8} rows={6} />
      </SkeletonPageBody>
    </PageSection>
  );
}
