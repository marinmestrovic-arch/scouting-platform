import React from "react";

import { DatabaseWorkspace } from "../../../components/database/database-workspace";
import { PageSection } from "../../../components/layout/page-section";

export default function CatalogPage() {
  return (
    <PageSection
      title="Catalog"
      description="Browse the canonical creator catalog with full-width filters, enrichment actions, and export shortcuts."
    >
      <DatabaseWorkspace forcedTab="catalog" />
    </PageSection>
  );
}
