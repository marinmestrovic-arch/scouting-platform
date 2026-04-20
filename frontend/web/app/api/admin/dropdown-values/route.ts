import {
  listDropdownValuesResponseSchema,
  syncHubspotDropdownValuesResponseSchema,
  updateDropdownValuesRequestSchema,
} from "@scouting-platform/contracts";
import {
  listDropdownValues,
  replaceDropdownValues,
  syncHubspotDropdownValues,
} from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { cachedJson, requireAdminSession, toRouteErrorResponse } from "../../../../lib/api";

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    const response = await listDropdownValues();
    return cachedJson(listDropdownValuesResponseSchema.parse(response), { maxAge: 300 });
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

export async function POST(): Promise<NextResponse> {
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    const updated = await syncHubspotDropdownValues({
      actorUserId: admin.userId,
    });

    return NextResponse.json(syncHubspotDropdownValuesResponseSchema.parse(updated));
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
