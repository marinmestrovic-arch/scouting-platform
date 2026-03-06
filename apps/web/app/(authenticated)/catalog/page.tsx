import { PageSection } from "../../../components/layout/page-section";
import { RouteScaffoldList } from "../../../components/layout/route-scaffold-list";

export default function CatalogPage() {
  return (
    <PageSection
      title="Catalog"
      description="Catalog list and filtering UX lands in Week 1."
    >
      <RouteScaffoldList
        heading="Week 1 shell paths"
        paths={["/catalog", "/catalog/[channelId]"]}
      />
    </PageSection>
  );
}
