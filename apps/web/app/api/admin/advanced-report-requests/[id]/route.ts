import { adminAdvancedReportRequestDetailSchema } from "@scouting-platform/contracts";
import { getAdminAdvancedReportRequestById } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession, toRouteErrorResponse } from "../../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
});

export async function GET(
  _request: Request,
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
        { error: "Invalid advanced report request id" },
        { status: 400 },
      );
    }

    const request = await getAdminAdvancedReportRequestById(params.data.id);

    if (!request) {
      return NextResponse.json(
        { error: "Advanced report request not found" },
        { status: 404 },
      );
    }

    const payload = adminAdvancedReportRequestDetailSchema.parse(request);
    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
