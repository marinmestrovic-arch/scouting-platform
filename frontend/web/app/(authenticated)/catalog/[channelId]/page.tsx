import React, { Suspense } from "react";

import { getChannelById } from "@scouting-platform/core";
import { getSession } from "../../../../lib/cached-auth";
import { ChannelDetailShell } from "../../../../components/catalog/channel-detail-shell";
import { Skeleton, SkeletonPageBody, SkeletonText } from "../../../../components/ui/skeleton";
import { getRoleFromSession } from "../../../../lib/access-control";

type CatalogChannelDetailPageProps = Readonly<{
  params: Promise<{ channelId: string }>;
}>;

async function ChannelDetailData({ channelId }: { channelId: string }) {
  const session = await getSession();
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

function ChannelDetailFallback() {
  return (
    <SkeletonPageBody>
      <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start", padding: "1.5rem 0" }}>
        <Skeleton borderRadius="50%" height="4.5rem" width="4.5rem" />
        <div style={{ display: "grid", gap: "0.75rem", flex: 1 }}>
          <Skeleton height="1.5rem" width="14rem" />
          <SkeletonText lines={2} width="22rem" />
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            <Skeleton borderRadius="var(--radius-md)" height="2rem" width="6rem" />
            <Skeleton borderRadius="var(--radius-md)" height="2rem" width="6rem" />
          </div>
        </div>
      </div>
      <Skeleton height="18rem" width="100%" />
    </SkeletonPageBody>
  );
}

export default async function CatalogChannelDetailPage({ params }: CatalogChannelDetailPageProps) {
  const { channelId } = await params;

  return (
    <Suspense fallback={<ChannelDetailFallback />}>
      <ChannelDetailData channelId={channelId} />
    </Suspense>
  );
}
