import { getChannelById } from "@scouting-platform/core";
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
  const initialData = await getChannelById(channelId);

  return (
    <ChannelDetailShell
      canManageManualEdits={canManageManualEdits}
      channelId={channelId}
      initialData={initialData}
    />
  );
}
