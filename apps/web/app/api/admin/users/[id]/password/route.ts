import { updateAdminUserPasswordRequestSchema } from "@scouting-platform/contracts";
import { updateUserPassword } from "@scouting-platform/core";
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

    const body = updateAdminUserPasswordRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    const user = await updateUserPassword({
      userId: params.data.id,
      password: body.data.password,
      actorUserId: admin.userId,
    });

    return NextResponse.json(user);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
