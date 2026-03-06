import { channelDetailSchema } from "@scouting-platform/contracts";
import { getChannelById } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAuthenticatedSession,
  toRouteErrorResponse,
} from "../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
});

export async function GET(
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

    const channel = await getChannelById(params.data.id);

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const payload = channelDetailSchema.parse(channel);
    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
