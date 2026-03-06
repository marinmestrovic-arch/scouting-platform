import {
  segmentResponseSchema,
  updateSegmentRequestSchema,
} from "@scouting-platform/contracts";
import { deleteUserSegment, updateUserSegment } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAuthenticatedSession,
  toRouteErrorResponse,
} from "../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const params = paramsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json({ error: "Invalid segment id" }, { status: 400 });
    }

    const body = updateSegmentRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    const updated = await updateUserSegment({
      userId: session.userId,
      segmentId: params.data.id,
      name: body.data.name,
      filters: body.data.filters,
    });
    const payload = segmentResponseSchema.parse(updated);

    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}

export async function DELETE(
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
      return NextResponse.json({ error: "Invalid segment id" }, { status: 400 });
    }

    await deleteUserSegment({
      userId: session.userId,
      segmentId: params.data.id,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
