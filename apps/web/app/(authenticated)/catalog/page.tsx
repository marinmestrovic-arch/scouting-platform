import React from "react";

import { DatabaseWorkspace } from "../../../components/database/database-workspace";
import { PageSection } from "../../../components/layout/page-section";

export default function CatalogPage() {
  return (
    <PageSection
      title="Catalog"
      description="Legacy shortcut to the Database catalog tab. The catalog remains the canonical creator workspace for filters, selection, export, and HubSpot actions."
    >
      <DatabaseWorkspace forcedTab="catalog" showLegacyNotice />
    </PageSection>
  );
}
