import { adminDashboardResponseSchema } from "@scouting-platform/contracts";
import { getAdminDashboardSummary } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { requireAdminSession, toRouteErrorResponse } from "../../../../lib/api";

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    const summary = await getAdminDashboardSummary();
    const payload = adminDashboardResponseSchema.parse(summary);
    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
