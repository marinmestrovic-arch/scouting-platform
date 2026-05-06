import React, { Suspense } from "react";

import type { CampaignManagerOption, DropdownValue } from "@scouting-platform/contracts";
import { getSession } from "../../../lib/cached-auth";
import { getCachedCampaigns, getCachedCampaignManagers, getCachedDropdownValues } from "../../../lib/cached-data";
import { PageHeader } from "../../../components/layout/PageHeader";
import { NewScoutingWorkspace } from "../../../components/scouting/new-scouting-workspace";
import { Skeleton, SkeletonPageBody } from "../../../components/ui/skeleton";

function getDropdownFieldValues(
  items: readonly DropdownValue[],
  fieldKey: "countryRegion" | "language" | "influencerVertical",
): string[] {
  const values = items
    .filter((item) => item.fieldKey === fieldKey)
    .map((item) => item.value.trim())
    .filter((value) => value.length > 0);

  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function NewScoutingData() {
  const session = await getSession();
  const [campaigns, campaignManagers, dropdownValues] = session?.user?.id
    ? await Promise.all([
        getCachedCampaigns(session.user.id, { active: true }),
        getCachedCampaignManagers(),
        getCachedDropdownValues(),
      ])
    : [
        {
          items: [],
          filterOptions: { clients: [], markets: [] },
          permissions: { canCreate: false, role: "user", userType: "campaign_manager" as const },
        },
        [] as CampaignManagerOption[],
        { items: [] as DropdownValue[] },
      ];

  return (
    <NewScoutingWorkspace
      initialCampaignManagers={campaignManagers}
      initialCampaigns={campaigns.items}
      initialCountryRegionOptions={getDropdownFieldValues(dropdownValues.items, "countryRegion")}
      initialInfluencerVerticalOptions={getDropdownFieldValues(dropdownValues.items, "influencerVertical")}
      initialLanguageOptions={getDropdownFieldValues(dropdownValues.items, "language")}
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
    <section className="page-section">
      <PageHeader
        crumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "New Scouting" },
        ]}
        title="New Scouting"
      />
      <div className="page-container page-section__body">
        <Suspense fallback={<NewScoutingFallback />}>
          <NewScoutingData />
        </Suspense>
      </div>
    </section>
  );
}
