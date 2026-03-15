import {
  createRunRequestSchema,
  createRunResponseSchema,
  listRecentRunsResponseSchema,
} from "@scouting-platform/contracts";
import { createRunRequest, listRecentRuns } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import {
  requireAuthenticatedSession,
  toRouteErrorResponse,
} from "../../../lib/api";

const RECENT_RUNS_LIMIT = 10;

export async function GET(): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const runs = await listRecentRuns({
      userId: session.userId,
      limit: RECENT_RUNS_LIMIT,
    });
    const payload = listRecentRunsResponseSchema.parse(runs);

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
    const body = createRunRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    const run = await createRunRequest({
      userId: session.userId,
      name: body.data.name,
      query: body.data.query,
      target: body.data.target,
    });
    const payload = createRunResponseSchema.parse(run);

    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
