import {
  listChannelsQuerySchema,
  listChannelsResponseSchema,
} from "@scouting-platform/contracts";
import { listChannels } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import {
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
    const parsedQuery = listChannelsQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      query: url.searchParams.get("query") ?? undefined,
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          details: parsedQuery.error.flatten(),
        },
        { status: 400 },
      );
    }

    const listInput = {
      page: parsedQuery.data.page,
      pageSize: parsedQuery.data.pageSize,
      ...(parsedQuery.data.query ? { query: parsedQuery.data.query } : {}),
    };
    const result = await listChannels(listInput);
    const payload = listChannelsResponseSchema.parse(result);

    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
