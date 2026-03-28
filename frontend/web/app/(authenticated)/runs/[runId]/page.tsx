import React, { Suspense } from "react";

import { getRunStatus } from "@scouting-platform/core";

import { getSession } from "../../../../lib/cached-auth";
import { PageSection } from "../../../../components/layout/page-section";
import { RunDetailShell } from "../../../../components/runs/run-detail-shell";
import { Skeleton, SkeletonPageBody, SkeletonTable, SkeletonText } from "../../../../components/ui/skeleton";
import { getRoleFromSession } from "../../../../lib/access-control";

type RunDetailPageProps = Readonly<{
  params: Promise<{ runId: string }>;
}>;

async function RunDetailData({ runId }: { runId: string }) {
  const session = await getSession();
  const initialData =
    session?.user?.id
      ? await getRunStatus({
          runId,
          userId: session.user.id,
          role: getRoleFromSession(session),
        }).catch((error: unknown) => {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error as { code?: string }).code === "RUN_NOT_FOUND"
          ) {
            return null;
          }

          throw error;
        })
      : null;

  return <RunDetailShell initialData={initialData} runId={runId} />;
}

function RunDetailFallback() {
  return (
    <SkeletonPageBody>
      <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
        <Skeleton borderRadius="var(--radius-md)" height="2rem" width="6rem" />
        <SkeletonText width="10rem" />
      </div>
      <SkeletonTable columns={6} rows={5} />
    </SkeletonPageBody>
  );
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { runId } = await params;

  return (
    <PageSection
      title="Run Detail"
      description="Track discovery status, inspect stored snapshot results, and surface queue failures without leaving the runs surface."
    >
      <Suspense fallback={<RunDetailFallback />}>
        <RunDetailData runId={runId} />
      </Suspense>
    </PageSection>
  );
}
