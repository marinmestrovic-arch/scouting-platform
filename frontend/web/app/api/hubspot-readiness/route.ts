import { hubspotReadinessSchema } from "@scouting-platform/contracts";
import { getHubspotReadiness } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, toRouteErrorResponse } from "../../../lib/api";

const querySchema = z.object({
  runId: z.uuid(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const url = new URL(request.url);
    const query = querySchema.safeParse({
      runId: url.searchParams.get("runId"),
    });

    if (!query.success) {
      return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
    }

    const readiness = await getHubspotReadiness({
      requestedByUserId: session.userId,
      role: session.role,
      runId: query.data.runId,
    });
    const payload = hubspotReadinessSchema.parse(readiness);

    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
