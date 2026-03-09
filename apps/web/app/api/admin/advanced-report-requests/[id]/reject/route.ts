import {
  adminAdvancedReportRequestDetailSchema,
  decideAdvancedReportRequestSchema,
} from "@scouting-platform/contracts";
import { rejectAdvancedReportRequest } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession, toRouteErrorResponse } from "../../../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
});

export async function POST(
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
        { error: "Invalid advanced report request id" },
        { status: 400 },
      );
    }

    const body = decideAdvancedReportRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = await rejectAdvancedReportRequest({
      advancedReportRequestId: params.data.id,
      actorUserId: admin.userId,
      ...(body.data.decisionNote ? { decisionNote: body.data.decisionNote } : {}),
    });
    const payload = adminAdvancedReportRequestDetailSchema.parse(result);

    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
