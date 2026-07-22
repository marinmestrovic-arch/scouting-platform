import React, { Suspense } from "react";
import { redirect } from "next/navigation";

import { getHubspotExportPreview } from "@scouting-platform/core";
import { getSession } from "../../../../../lib/cached-auth";
import { ExportPreparationWorkspace } from "../../../../../components/exports/export-preparation-workspace";
import { PageHeader } from "../../../../../components/layout/PageHeader";
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

  const preview = await getHubspotExportPreview({
    runId,
    userId: session.user.id,
    role: getRoleFromSession(session),
  });

  return <ExportPreparationWorkspace preview={preview} />;
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
    <section className="page-section">
      <PageHeader
        crumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prepare for HubSpot" },
        ]}
        title="Prepare for HubSpot"
      />
      <div className="page-container page-section__body">
        <Suspense fallback={<ExportPrepareFallback />}>
          <ExportPrepareData runId={runId} />
        </Suspense>
      </div>
    </section>
  );
}
