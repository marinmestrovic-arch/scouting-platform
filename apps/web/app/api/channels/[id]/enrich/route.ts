import { requestChannelEnrichmentResponseSchema } from "@scouting-platform/contracts";
import { requestChannelLlmEnrichment } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAuthenticatedSession,
  toRouteErrorResponse,
} from "../../../../../lib/api";

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
      return NextResponse.json({ error: "Invalid channel id" }, { status: 400 });
    }

    const result = await requestChannelLlmEnrichment({
      channelId: params.data.id,
      requestedByUserId: session.userId,
    });
    const payload = requestChannelEnrichmentResponseSchema.parse(result);

    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
