import React, { Suspense } from "react";
import { redirect } from "next/navigation";

import { getHubspotExportPreview } from "@scouting-platform/core";
import { getSession } from "../../../../../lib/cached-auth";
import { ExportPreparationWorkspace } from "../../../../../components/exports/export-preparation-workspace";
import { PageHeader } from "../../../../../components/layout/PageHeader";
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
    <section className="page-section">
      <PageHeader
        crumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Export to Google Sheets" },
        ]}
        title="Export to Google Sheets"
      />
      <div className="page-container page-section__body">
        <Suspense fallback={<HubspotPrepareFallback />}>
          <HubspotPrepareData runId={runId} />
        </Suspense>
      </div>
    </section>
  );
}
