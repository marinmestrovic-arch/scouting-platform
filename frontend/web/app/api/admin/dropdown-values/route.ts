import {
  listDropdownValuesResponseSchema,
  updateDropdownValuesRequestSchema,
} from "@scouting-platform/contracts";
import { listDropdownValues, replaceDropdownValues } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { requireAdminSession, toRouteErrorResponse } from "../../../../lib/api";

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    const response = await listDropdownValues();
    return NextResponse.json(listDropdownValuesResponseSchema.parse(response));
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    const body = updateDropdownValuesRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: body.error.flatten() },
        { status: 400 },
      );
    }

    const updated = await replaceDropdownValues({
      actorUserId: admin.userId,
      ...body.data,
    });

    return NextResponse.json(listDropdownValuesResponseSchema.parse(updated));
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
