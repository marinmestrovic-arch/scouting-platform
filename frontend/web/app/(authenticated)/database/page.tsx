import React, { Suspense } from "react";
import { listCampaigns, listClients, listDropdownValues } from "@scouting-platform/core";
import { redirect } from "next/navigation";

import { getSession } from "../../../lib/cached-auth";
import { DatabaseAdminWorkspace } from "../../../components/database/database-admin-workspace";
import { PageSection } from "../../../components/layout/page-section";
import { Skeleton, SkeletonPageBody, SkeletonTable } from "../../../components/ui/skeleton";

async function DatabaseData() {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const isAdmin = session.user.role === "admin";
  const [campaigns, clients, dropdownValues] = await Promise.all([
    listCampaigns({ userId: session.user.id, query: { active: true } }),
    listClients({ userId: session.user.id }),
    isAdmin ? listDropdownValues().then((response) => response.items) : Promise.resolve([]),
  ]);

  return (
    <DatabaseAdminWorkspace
      campaigns={campaigns}
      clients={clients}
      dropdownValues={dropdownValues}
      isAdmin={isAdmin}
    />
  );
}

function DatabaseFallback() {
  return (
    <SkeletonPageBody>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Skeleton borderRadius="var(--radius-md)" height="2.25rem" width="6rem" />
        <Skeleton borderRadius="var(--radius-md)" height="2.25rem" width="6rem" />
      </div>
      <SkeletonTable columns={6} rows={6} />
    </SkeletonPageBody>
  );
}

export default function DatabasePage() {
  return (
    <PageSection
      title="Database"
      description="Manage clients and campaigns from one database workspace while keeping creator catalog browsing in its own dedicated page."
    >
      <Suspense fallback={<DatabaseFallback />}>
        <DatabaseData />
      </Suspense>
    </PageSection>
  );
}
