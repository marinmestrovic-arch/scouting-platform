import React from "react";
import { redirect } from "next/navigation";

import { getHubspotExportPreview } from "@scouting-platform/core";
import { auth } from "../../../../../auth";
import { ExportPreparationWorkspace } from "../../../../../components/exports/export-preparation-workspace";
import { PageSection } from "../../../../../components/layout/page-section";
import { getRoleFromSession } from "../../../../../lib/access-control";

type HubspotPreparePageProps = Readonly<{
  params: Promise<{ runId: string }>;
}>;

export default async function HubspotPreparePage({ params }: HubspotPreparePageProps) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { runId } = await params;
  const preview = await getHubspotExportPreview({
    runId,
    userId: session.user.id,
    role: getRoleFromSession(session),
  });

  return (
    <PageSection
      title="HubSpot Preparation"
      description="Review all HubSpot columns, fill required gaps, and export a ready-to-import file."
    >
      <ExportPreparationWorkspace mode="hubspot" preview={preview} />
    </PageSection>
  );
}
