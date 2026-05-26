import {
  bulkDeleteChannelsRequestSchema,
  bulkDeleteChannelsResponseSchema,
} from "@scouting-platform/contracts";
import { bulkDeleteChannels } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { readJsonRequestBody, requireAdminSession, toRouteErrorResponse } from "../../../../../lib/api";

export async function POST(request: Request): Promise<NextResponse> {
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  const body = await readJsonRequestBody(request);

  if (!body.ok) {
    return body.response;
  }

  try {
    const payload = bulkDeleteChannelsRequestSchema.safeParse(body.body);

    if (!payload.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: payload.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = await bulkDeleteChannels({
      actorUserId: admin.userId,
      channelIds: payload.data.channelIds,
    });

    return NextResponse.json(bulkDeleteChannelsResponseSchema.parse(result));
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
