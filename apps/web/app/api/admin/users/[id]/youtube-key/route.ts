import { updateAdminUserYoutubeKeyRequestSchema } from "@scouting-platform/contracts";
import { setUserYoutubeApiKey } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession, toRouteErrorResponse } from "../../../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    const params = paramsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json(
        { error: "Invalid user id" },
        { status: 400 },
      );
    }

    const body = updateAdminUserYoutubeKeyRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    await setUserYoutubeApiKey({
      userId: params.data.id,
      rawKey: body.data.youtubeApiKey,
      actorUserId: admin.userId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
