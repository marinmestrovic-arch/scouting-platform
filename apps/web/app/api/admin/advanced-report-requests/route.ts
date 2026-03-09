import {
  adminAdvancedReportListQuerySchema,
  listAdminAdvancedReportRequestsResponseSchema,
} from "@scouting-platform/contracts";
import { listAdminAdvancedReportRequests } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { requireAdminSession, toRouteErrorResponse } from "../../../../lib/api";

export async function GET(request: Request): Promise<NextResponse> {
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    const url = new URL(request.url);
    const parsedQuery = adminAdvancedReportListQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          details: parsedQuery.error.flatten(),
        },
        { status: 400 },
      );
    }

    const items = await listAdminAdvancedReportRequests({
      ...(parsedQuery.data.status ? { status: parsedQuery.data.status } : {}),
    });
    const payload = listAdminAdvancedReportRequestsResponseSchema.parse({ items });

    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
