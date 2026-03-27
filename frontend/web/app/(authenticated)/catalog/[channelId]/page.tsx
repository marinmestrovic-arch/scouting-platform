import { auth } from "../../../../auth";
import { ChannelDetailShell } from "../../../../components/catalog/channel-detail-shell";
import { getRoleFromSession } from "../../../../lib/access-control";

type CatalogChannelDetailPageProps = Readonly<{
  params: Promise<{ channelId: string }>;
}>;

export default async function CatalogChannelDetailPage({ params }: CatalogChannelDetailPageProps) {
  const session = await auth();
  const { channelId } = await params;
  const canManageManualEdits = getRoleFromSession(session) === "admin";

  return <ChannelDetailShell channelId={channelId} canManageManualEdits={canManageManualEdits} />;
}
