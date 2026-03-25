import { hubspotImportBatchDetailSchema } from "@scouting-platform/contracts";
import { getHubspotImportBatchById } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, toRouteErrorResponse } from "../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
});

export async function GET(
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
      return NextResponse.json({ error: "Invalid HubSpot import batch id" }, { status: 400 });
    }

    const batch = await getHubspotImportBatchById({
      importBatchId: params.data.id,
      requestedByUserId: session.userId,
      role: session.role,
    });
    const payload = hubspotImportBatchDetailSchema.parse(batch);

    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
