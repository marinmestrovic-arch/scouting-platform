import React, { Suspense } from "react";

import type { CampaignManagerOption } from "@scouting-platform/contracts";
import { getSession } from "../../../lib/cached-auth";
import { getCachedCampaigns, getCachedCampaignManagers } from "../../../lib/cached-data";
import { PageSection } from "../../../components/layout/page-section";
import { NewScoutingWorkspace } from "../../../components/scouting/new-scouting-workspace";
import { Skeleton, SkeletonPageBody } from "../../../components/ui/skeleton";

async function NewScoutingData() {
  const session = await getSession();
  const [campaigns, campaignManagers] = session?.user?.id
    ? await Promise.all([
        getCachedCampaigns(session.user.id, { active: true }),
        getCachedCampaignManagers(),
      ])
    : [
        { items: [], filterOptions: { clients: [], markets: [] }, permissions: { canCreate: false, role: "user", userType: "campaign_manager" as const } },
        [] as CampaignManagerOption[],
      ];

  return (
    <NewScoutingWorkspace
      initialCampaignManagers={campaignManagers}
      initialCampaigns={campaigns.items}
    />
  );
}

function NewScoutingFallback() {
  return (
    <SkeletonPageBody>
      <div style={{ display: "grid", gap: "1.25rem", maxWidth: "36rem" }}>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <Skeleton height="0.7rem" width="5rem" />
          <Skeleton borderRadius="var(--radius-md)" height="2.5rem" width="100%" />
        </div>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <Skeleton height="0.7rem" width="7rem" />
          <Skeleton borderRadius="var(--radius-md)" height="2.5rem" width="100%" />
        </div>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <Skeleton height="0.7rem" width="4rem" />
          <Skeleton borderRadius="var(--radius-md)" height="2.5rem" width="100%" />
        </div>
        <Skeleton borderRadius="var(--radius-md)" height="2.5rem" width="10rem" />
      </div>
    </SkeletonPageBody>
  );
}

export default function NewScoutingPage() {
  return (
    <PageSection
      title="New scouting"
      description="Start a scouting run from an active campaign with the minimum required input and preserve campaign data as a run snapshot."
    >
      <Suspense fallback={<NewScoutingFallback />}>
        <NewScoutingData />
      </Suspense>
    </PageSection>
  );
}
