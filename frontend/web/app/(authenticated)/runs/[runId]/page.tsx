import { getRunStatus } from "@scouting-platform/core";

import { auth } from "../../../../auth";
import { PageSection } from "../../../../components/layout/page-section";
import { RunDetailShell } from "../../../../components/runs/run-detail-shell";
import { getRoleFromSession } from "../../../../lib/access-control";

type RunDetailPageProps = Readonly<{
  params: Promise<{ runId: string }>;
}>;

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const session = await auth();
  const { runId } = await params;
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

  return (
    <PageSection
      title="Run Detail"
      description="Track discovery status, inspect stored snapshot results, and surface queue failures without leaving the runs surface."
    >
      <RunDetailShell initialData={initialData} runId={runId} />
    </PageSection>
  );
}
