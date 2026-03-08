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
      description="Week 1 shell only. Live channel data lands in Week 2. Enrichment and editing workflows stay deferred to later milestones."
    >
      <ChannelDetailShell channelId={channelId} />
    </PageSection>
  );
}
