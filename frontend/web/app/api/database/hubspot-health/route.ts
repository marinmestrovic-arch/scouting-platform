import { hubspotHealthStateSchema } from "@scouting-platform/contracts";
import {
  getHubspotHealthState,
  requestHubspotHealthCheck,
} from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { requireAdminSession, toRouteErrorResponse } from "../../../../lib/api";

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    const state = await getHubspotHealthState({
      requestedByUserId: admin.userId,
    });
    const payload = hubspotHealthStateSchema.parse(state);

    return NextResponse.json(payload);
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
    const state = await requestHubspotHealthCheck({
      requestedByUserId: admin.userId,
    });
    const payload = hubspotHealthStateSchema.parse(state);

    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
