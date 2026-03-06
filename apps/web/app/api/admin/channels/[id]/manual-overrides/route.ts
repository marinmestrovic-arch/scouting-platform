import {
  patchChannelManualOverridesRequestSchema,
  patchChannelManualOverridesResponseSchema,
} from "@scouting-platform/contracts";
import { patchChannelManualOverrides } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession, toRouteErrorResponse } from "../../../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
});

export async function PATCH(
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
      return NextResponse.json({ error: "Invalid channel id" }, { status: 400 });
    }

    const body = patchChannelManualOverridesRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = await patchChannelManualOverrides({
      channelId: params.data.id,
      actorUserId: admin.userId,
      operations: body.data.operations,
    });
    const payload = patchChannelManualOverridesResponseSchema.parse(result);

    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
