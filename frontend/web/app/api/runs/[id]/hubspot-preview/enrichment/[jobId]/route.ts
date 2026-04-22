import { getHubspotPreviewEnrichmentStatusResponseSchema } from "@scouting-platform/contracts";
import { getHubspotPreviewEnrichmentJob } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, toRouteErrorResponse } from "../../../../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; jobId: string }> },
): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const params = paramsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json({ error: "Invalid enrichment job id" }, { status: 400 });
    }

    const job = await getHubspotPreviewEnrichmentJob({
      runId: params.data.id,
      enrichmentJobId: params.data.jobId,
      userId: session.userId,
      role: session.role,
    });
    const payload = getHubspotPreviewEnrichmentStatusResponseSchema.parse({ job });

    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
