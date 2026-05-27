import {
  bulkRetryChannelEnrichmentRequestSchema,
  bulkRetryChannelEnrichmentResponseSchema,
} from "@scouting-platform/contracts";
import { requestBulkChannelLlmEnrichment } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import {
  requireAuthenticatedSession,
  toRouteErrorResponse,
} from "../../../../../lib/api";

export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const body = bulkRetryChannelEnrichmentRequestSchema.safeParse(rawBody);

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = await requestBulkChannelLlmEnrichment({
      filters: body.data.filters,
      requestedByUserId: session.userId,
    });
    const payload = bulkRetryChannelEnrichmentResponseSchema.parse(result);

    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
