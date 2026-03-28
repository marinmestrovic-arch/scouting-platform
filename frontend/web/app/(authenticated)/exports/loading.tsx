import React from "react";
import { PageSection } from "../../../components/layout/page-section";
import {
  SkeletonPageBody,
  SkeletonTable,
} from "../../../components/ui/skeleton";

export default function ExportsLoading() {
  return (
    <PageSection
      title="Exports"
      description="Create filtered CSV exports from catalog criteria and review your export batch history without leaving the authenticated workspace."
    >
      <SkeletonPageBody>
        <SkeletonTable columns={5} rows={4} />
      </SkeletonPageBody>
    </PageSection>
  );
}
