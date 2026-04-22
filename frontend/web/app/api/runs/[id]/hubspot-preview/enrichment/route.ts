import {
  createHubspotPreviewEnrichmentResponseSchema,
} from "@scouting-platform/contracts";
import { createHubspotPreviewEnrichmentJob } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, toRouteErrorResponse } from "../../../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const params = paramsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
    }

    const job = await createHubspotPreviewEnrichmentJob({
      runId: params.data.id,
      userId: session.userId,
      role: session.role,
      actorUserId: session.userId,
    });
    const payload = createHubspotPreviewEnrichmentResponseSchema.parse({ job });

    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
