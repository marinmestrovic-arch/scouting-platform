import React, { Suspense } from "react";
import { redirect } from "next/navigation";

import { getCsvExportPreview } from "@scouting-platform/core";
import { getSession } from "../../../../../lib/cached-auth";
import { ExportPreparationWorkspace } from "../../../../../components/exports/export-preparation-workspace";
import { PageSection } from "../../../../../components/layout/page-section";
import { SkeletonPageBody, SkeletonTable } from "../../../../../components/ui/skeleton";
import { getRoleFromSession } from "../../../../../lib/access-control";

type ExportPreparePageProps = Readonly<{
  params: Promise<{ runId: string }>;
}>;

async function ExportPrepareData({ runId }: { runId: string }) {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const preview = await getCsvExportPreview({
    runId,
    userId: session.user.id,
    role: getRoleFromSession(session),
  });

  return <ExportPreparationWorkspace mode="csv" preview={preview} />;
}

function ExportPrepareFallback() {
  return (
    <SkeletonPageBody>
      <SkeletonTable columns={8} rows={6} />
    </SkeletonPageBody>
  );
}

export default async function ExportPreparePage({ params }: ExportPreparePageProps) {
  const { runId } = await params;

  return (
    <PageSection
      title="CSV Preparation"
      description="Review the full export table and download a CSV directly from the prepared run snapshot."
    >
      <Suspense fallback={<ExportPrepareFallback />}>
        <ExportPrepareData runId={runId} />
      </Suspense>
    </PageSection>
  );
}
