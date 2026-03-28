import React from "react";
import { PageSection } from "../../../components/layout/page-section";
import {
  SkeletonFilterBar,
  SkeletonPageBody,
  SkeletonTable,
} from "../../../components/ui/skeleton";

export default function CatalogLoading() {
  return (
    <PageSection
      title="Catalog"
      description="Browse the canonical creator catalog with full-width filters, enrichment actions, and export shortcuts."
    >
      <SkeletonPageBody>
        <SkeletonFilterBar filters={3} />
        <SkeletonTable columns={8} rows={8} />
      </SkeletonPageBody>
    </PageSection>
  );
}
