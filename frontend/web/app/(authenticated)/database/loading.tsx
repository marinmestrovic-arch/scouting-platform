import React from "react";
import { PageSection } from "../../../components/layout/page-section";
import {
  Skeleton,
  SkeletonPageBody,
  SkeletonTable,
} from "../../../components/ui/skeleton";

export default function DatabaseLoading() {
  return (
    <PageSection
      title="Database"
      description="Manage clients and campaigns from one database workspace while keeping creator catalog browsing in its own dedicated page."
    >
      <SkeletonPageBody>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Skeleton borderRadius="var(--radius-md)" height="2.25rem" width="6rem" />
          <Skeleton borderRadius="var(--radius-md)" height="2.25rem" width="6rem" />
        </div>
        <SkeletonTable columns={6} rows={6} />
      </SkeletonPageBody>
    </PageSection>
  );
}
