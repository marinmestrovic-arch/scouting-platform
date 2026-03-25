import { downloadHubspotImportBatch } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, toRouteErrorResponse } from "../../../../../lib/api";

const paramsSchema = z.object({
  id: z.uuid(),
});

function sanitizeFileName(fileName: string): string {
  return fileName.replaceAll(`"`, "");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const params = paramsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json({ error: "Invalid HubSpot import batch id" }, { status: 400 });
    }

    const batch = await downloadHubspotImportBatch({
      importBatchId: params.data.id,
      requestedByUserId: session.userId,
      role: session.role,
    });

    return new Response(batch.csvContent, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${sanitizeFileName(batch.fileName)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
