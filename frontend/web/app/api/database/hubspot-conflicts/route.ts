import {
  hubspotConflictStatusSchema,
  listHubspotConflictsResponseSchema,
} from "@scouting-platform/contracts";
import { listHubspotConflicts } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { requireAdminSession, toRouteErrorResponse } from "../../../../lib/api";

export async function GET(request: Request): Promise<NextResponse> {
  const admin = await requireAdminSession();
  if (!admin.ok) {
    return admin.response;
  }

  try {
    const requestedStatus = new URL(request.url).searchParams.get("status") ?? "open";
    const parsedStatus = requestedStatus === "all"
      ? "all"
      : hubspotConflictStatusSchema.safeParse(requestedStatus);
    if (parsedStatus !== "all" && !parsedStatus.success) {
      return NextResponse.json({ error: "Invalid conflict status" }, { status: 400 });
    }

    const items = await listHubspotConflicts({
      status: parsedStatus === "all" ? "all" : parsedStatus.data,
    });
    return NextResponse.json(listHubspotConflictsResponseSchema.parse({ items }));
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}

