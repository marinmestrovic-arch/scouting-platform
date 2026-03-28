import React, { Suspense } from "react";
import { redirect } from "next/navigation";

import { getHubspotExportPreview } from "@scouting-platform/core";
import { getSession } from "../../../../../lib/cached-auth";
import { ExportPreparationWorkspace } from "../../../../../components/exports/export-preparation-workspace";
import { PageSection } from "../../../../../components/layout/page-section";
import { SkeletonPageBody, SkeletonTable } from "../../../../../components/ui/skeleton";
import { getRoleFromSession } from "../../../../../lib/access-control";

type HubspotPreparePageProps = Readonly<{
  params: Promise<{ runId: string }>;
}>;

async function HubspotPrepareData({ runId }: { runId: string }) {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const preview = await getHubspotExportPreview({
    runId,
    userId: session.user.id,
    role: getRoleFromSession(session),
  });

  return <ExportPreparationWorkspace mode="hubspot" preview={preview} />;
}

function HubspotPrepareFallback() {
  return (
    <SkeletonPageBody>
      <SkeletonTable columns={8} rows={6} />
    </SkeletonPageBody>
  );
}

export default async function HubspotPreparePage({ params }: HubspotPreparePageProps) {
  const { runId } = await params;

  return (
    <PageSection
      title="HubSpot Preparation"
      description="Review all HubSpot columns, fill required gaps, and export a ready-to-import file."
    >
      <Suspense fallback={<HubspotPrepareFallback />}>
        <HubspotPrepareData runId={runId} />
      </Suspense>
    </PageSection>
  );
}
