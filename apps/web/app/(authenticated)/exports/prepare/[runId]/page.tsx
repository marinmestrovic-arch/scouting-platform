import React from "react";
import { redirect } from "next/navigation";

import { getCsvExportPreview } from "@scouting-platform/core";
import { auth } from "../../../../../auth";
import { ExportPreparationWorkspace } from "../../../../../components/exports/export-preparation-workspace";
import { PageSection } from "../../../../../components/layout/page-section";
import { getRoleFromSession } from "../../../../../lib/access-control";

type ExportPreparePageProps = Readonly<{
  params: Promise<{ runId: string }>;
}>;

export default async function ExportPreparePage({ params }: ExportPreparePageProps) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { runId } = await params;
  const preview = await getCsvExportPreview({
    runId,
    userId: session.user.id,
    role: getRoleFromSession(session),
  });

  return (
    <PageSection
      title="CSV Preparation"
      description="Review the full export table and download a CSV directly from the prepared run snapshot."
    >
      <ExportPreparationWorkspace mode="csv" preview={preview} />
    </PageSection>
  );
}
