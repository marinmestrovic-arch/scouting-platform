import { PageSection } from "../../../components/layout/page-section";
import { CatalogTableShell } from "../../../components/catalog/catalog-table-shell";

export default function CatalogPage() {
  return (
    <PageSection
      title="Catalog"
      description="Browse the shared creator catalog. Filters land in Week 2."
    >
      <CatalogTableShell />
    </PageSection>
  );
}
