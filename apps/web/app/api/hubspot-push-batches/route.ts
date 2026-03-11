import {
  createHubspotPushBatchRequestSchema,
  hubspotPushBatchSummarySchema,
  listHubspotPushBatchesResponseSchema,
} from "@scouting-platform/contracts";
import { createHubspotPushBatch, listHubspotPushBatches } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { requireAuthenticatedSession, toRouteErrorResponse } from "../../../lib/api";

export async function GET(): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const items = await listHubspotPushBatches({
      requestedByUserId: session.userId,
    });
    const payload = listHubspotPushBatchesResponseSchema.parse({ items });

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
    const body = createHubspotPushBatchRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    const batch = await createHubspotPushBatch({
      requestedByUserId: session.userId,
      channelIds: body.data.channelIds,
    });
    const payload = hubspotPushBatchSummarySchema.parse(batch);

    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
