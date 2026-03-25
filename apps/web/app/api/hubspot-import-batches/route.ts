import {
  createHubspotImportBatchRequestSchema,
  hubspotImportBatchSummarySchema,
  hubspotImportBatchValidationErrorSchema,
  listHubspotImportBatchesResponseSchema,
} from "@scouting-platform/contracts";
import {
  createHubspotImportBatch,
  getHubspotImportBlockers,
  listHubspotImportBatches,
} from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { requireAuthenticatedSession, toRouteErrorResponse } from "../../../lib/api";

export async function GET(): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const items = await listHubspotImportBatches({
      requestedByUserId: session.userId,
      role: session.role,
    });
    const payload = listHubspotImportBatchesResponseSchema.parse({ items });

    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const body = createHubspotImportBatchRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    const blockers = await getHubspotImportBlockers({
      runId: body.data.runId,
      requestedByUserId: session.userId,
      role: session.role,
    });

    if (blockers.length > 0) {
      const payload = hubspotImportBatchValidationErrorSchema.parse({
        error: "HubSpot import batch has missing required fields",
        blockers,
      });

      return NextResponse.json(payload, { status: 409 });
    }

    const batch = await createHubspotImportBatch({
      runId: body.data.runId,
      requestedByUserId: session.userId,
      role: session.role,
    });
    const payload = hubspotImportBatchSummarySchema.parse(batch);

    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
