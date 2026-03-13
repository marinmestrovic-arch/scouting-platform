import React from "react";

import { CsvExportManager } from "../../../components/exports/csv-export-manager";
import { PageSection } from "../../../components/layout/page-section";

export default function ExportsPage() {
  return (
    <PageSection
      title="Exports"
      description="Create filtered CSV exports from catalog criteria and review your export batch history without leaving the authenticated workspace."
    >
      <CsvExportManager />
    </PageSection>
  );
}
