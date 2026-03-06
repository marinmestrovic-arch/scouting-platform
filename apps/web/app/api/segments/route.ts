import {
  createSegmentRequestSchema,
  listSegmentsResponseSchema,
  segmentResponseSchema,
} from "@scouting-platform/contracts";
import { createUserSegment, listUserSegments } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import {
  requireAuthenticatedSession,
  toRouteErrorResponse,
} from "../../../lib/api";

export async function GET(): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const segments = await listUserSegments(session.userId);
    const payload = listSegmentsResponseSchema.parse({ items: segments });
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
    const body = createSegmentRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    const created = await createUserSegment({
      userId: session.userId,
      name: body.data.name,
      filters: body.data.filters,
    });

    const payload = segmentResponseSchema.parse(created);
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
