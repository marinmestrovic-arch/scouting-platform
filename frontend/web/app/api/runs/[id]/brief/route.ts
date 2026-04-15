import {
  runMetadataResponseSchema,
  updateRunBriefRequestSchema,
} from "@scouting-platform/contracts";
import { updateRunBrief } from "@scouting-platform/core";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAuthenticatedSession,
  toRouteErrorResponse,
} from "../../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
});

export async function PATCH(
  request: NextRequest,
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

    const body = updateRunBriefRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid brief payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = await updateRunBrief({
      runId: params.data.id,
      userId: session.userId,
      role: session.role,
      brief: body.data,
    });
    const payload = runMetadataResponseSchema.parse(result);

    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
