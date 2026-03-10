import { ChannelDetailShell } from "../../../../components/catalog/channel-detail-shell";
import { PageSection } from "../../../../components/layout/page-section";

type CatalogChannelDetailPageProps = Readonly<{
  params: Promise<{ channelId: string }>;
}>;

export default async function CatalogChannelDetailPage({ params }: CatalogChannelDetailPageProps) {
  const { channelId } = await params;

  return (
    <PageSection
      title="Channel Detail"
      description="Review the resolved catalog profile, enrichment state, and advanced report context for a single channel."
    >
      <ChannelDetailShell channelId={channelId} />
    </PageSection>
  );
}
