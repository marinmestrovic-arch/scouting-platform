import React from "react";
import { PageSection } from "../../../components/layout/page-section";
import {
  Skeleton,
  SkeletonPageBody,
} from "../../../components/ui/skeleton";

export default function NewScoutingLoading() {
  return (
    <PageSection
      title="New scouting"
      description="Start a scouting run from an active campaign with the minimum required input and preserve campaign data as a run snapshot."
    >
      <SkeletonPageBody>
        <div style={{ display: "grid", gap: "1.25rem", maxWidth: "36rem" }}>
          <div style={{ display: "grid", gap: "0.4rem" }}>
            <Skeleton height="0.7rem" width="5rem" />
            <Skeleton borderRadius="var(--radius-md)" height="2.5rem" width="100%" />
          </div>
          <div style={{ display: "grid", gap: "0.4rem" }}>
            <Skeleton height="0.7rem" width="7rem" />
            <Skeleton borderRadius="var(--radius-md)" height="2.5rem" width="100%" />
          </div>
          <div style={{ display: "grid", gap: "0.4rem" }}>
            <Skeleton height="0.7rem" width="4rem" />
            <Skeleton borderRadius="var(--radius-md)" height="2.5rem" width="100%" />
          </div>
          <Skeleton borderRadius="var(--radius-md)" height="2.5rem" width="10rem" />
        </div>
      </SkeletonPageBody>
    </PageSection>
  );
}
