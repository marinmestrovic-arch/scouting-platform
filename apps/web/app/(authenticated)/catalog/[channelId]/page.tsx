import { auth } from "../../../../auth";
import { ChannelDetailShell } from "../../../../components/catalog/channel-detail-shell";
import { PageSection } from "../../../../components/layout/page-section";
import { getRoleFromSession } from "../../../../lib/access-control";

type CatalogChannelDetailPageProps = Readonly<{
  params: Promise<{ channelId: string }>;
}>;

export default async function CatalogChannelDetailPage({ params }: CatalogChannelDetailPageProps) {
  const session = await auth();
  const { channelId } = await params;
  const canManageManualEdits = getRoleFromSession(session) === "admin";

  return (
    <PageSection
      title="Channel Detail"
      description="Review the resolved catalog profile, enrichment state, advanced report context, and admin overrides for a single channel."
    >
      <ChannelDetailShell channelId={channelId} canManageManualEdits={canManageManualEdits} />
    </PageSection>
  );
}
