import React from "react";
import { PageSection } from "../../../../components/layout/page-section";
import {
  Skeleton,
  SkeletonPageBody,
  SkeletonTable,
  SkeletonText,
} from "../../../../components/ui/skeleton";

export default function RunDetailLoading() {
  return (
    <PageSection
      title="Run Detail"
      description="Track discovery status, inspect stored snapshot results, and surface queue failures without leaving the runs surface."
    >
      <SkeletonPageBody>
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
          <Skeleton borderRadius="var(--radius-md)" height="2rem" width="6rem" />
          <SkeletonText width="10rem" />
        </div>
        <SkeletonTable columns={6} rows={5} />
      </SkeletonPageBody>
    </PageSection>
  );
}
