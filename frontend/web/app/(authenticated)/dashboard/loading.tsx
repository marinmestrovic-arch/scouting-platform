import React from "react";
import { PageSection } from "../../../components/layout/page-section";
import {
  Skeleton,
  SkeletonFilterBar,
  SkeletonPageBody,
  SkeletonTable,
} from "../../../components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <PageSection
      title="Dashboard"
      description="Review recent scouting runs, track coverage against each run target, and hand each run off to Database, CSV export, or HubSpot from one compact table."
    >
      <SkeletonPageBody>
        <SkeletonFilterBar filters={3} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Skeleton borderRadius="var(--radius-md)" height="2rem" width="5rem" />
        </div>
        <SkeletonTable columns={7} rows={6} />
      </SkeletonPageBody>
    </PageSection>
  );
}
