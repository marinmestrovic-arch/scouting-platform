import { csvExportPreviewSchema } from "@scouting-platform/contracts";
import { getCsvExportPreview } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, toRouteErrorResponse } from "../../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const params = paramsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
    }

    const preview = await getCsvExportPreview({
      runId: params.data.id,
      userId: session.userId,
      role: session.role,
    });

    return NextResponse.json(csvExportPreviewSchema.parse(preview));
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
