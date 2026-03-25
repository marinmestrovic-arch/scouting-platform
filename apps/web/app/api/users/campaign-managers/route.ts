import { listCampaignManagersResponseSchema } from "@scouting-platform/contracts";
import { listCampaignManagers } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { requireAuthenticatedSession, toRouteErrorResponse } from "../../../../lib/api";

export async function GET(): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const items = await listCampaignManagers();
    const payload = listCampaignManagersResponseSchema.parse({ items });

    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
