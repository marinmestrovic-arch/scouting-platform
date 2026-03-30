import {
  createRunRequestSchema,
  createRunResponseSchema,
  listRunsQuerySchema,
  listRecentRunsResponseSchema,
} from "@scouting-platform/contracts";
import { createRunRequest, listRecentRuns } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import {
  cachedJson,
  requireAuthenticatedSession,
  toRouteErrorResponse,
} from "../../../lib/api";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const url = new URL(request.url);
    const query = listRunsQuerySchema.safeParse({
      campaignManagerUserId: url.searchParams.get("campaignManagerUserId") ?? undefined,
      client: url.searchParams.get("client") ?? undefined,
      market: url.searchParams.get("market") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    if (!query.success) {
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          details: query.error.flatten(),
        },
        { status: 400 },
      );
    }

    const runs = await listRecentRuns({
      userId: session.userId,
      role: session.role,
      limit: query.data.limit,
      ...(query.data.campaignManagerUserId
        ? { campaignManagerUserId: query.data.campaignManagerUserId }
        : {}),
      ...(query.data.client ? { client: query.data.client } : {}),
      ...(query.data.market ? { market: query.data.market } : {}),
    });
    const payload = listRecentRunsResponseSchema.parse(runs);

    return cachedJson(payload, { maxAge: 15 });
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
      metadata: body.data.metadata,
    });
    const payload = createRunResponseSchema.parse(run);

    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
