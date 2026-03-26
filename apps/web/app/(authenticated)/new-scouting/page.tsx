import React from "react";

import type { CampaignManagerOption } from "@scouting-platform/contracts";
import { listCampaignManagers, listCampaigns } from "@scouting-platform/core";
import { auth } from "../../../auth";
import { PageSection } from "../../../components/layout/page-section";
import { NewScoutingWorkspace } from "../../../components/scouting/new-scouting-workspace";

export default async function NewScoutingPage() {
  const session = await auth();
  const [campaigns, campaignManagers] = session?.user?.id
    ? await Promise.all([
        listCampaigns({
          userId: session.user.id,
          query: { active: true },
        }),
        listCampaignManagers(),
      ])
    : [
        { items: [], filterOptions: { clients: [], markets: [] }, permissions: { canCreate: false, role: "user", userType: "campaign_manager" as const } },
        [] as CampaignManagerOption[],
      ];

  return (
    <PageSection
      title="New scouting"
      description="Start a scouting run from an active campaign with the minimum required input and preserve campaign data as a run snapshot."
    >
      <NewScoutingWorkspace
        initialCampaignManagers={campaignManagers}
        initialCampaigns={campaigns.items}
      />
    </PageSection>
  );
}
