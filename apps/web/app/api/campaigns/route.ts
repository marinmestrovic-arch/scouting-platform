import {
  createCampaignRequestSchema,
  campaignSummarySchema,
  listCampaignsQuerySchema,
  listCampaignsResponseSchema,
} from "@scouting-platform/contracts";
import { createCampaign, listCampaigns } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { requireAuthenticatedSession, toRouteErrorResponse } from "../../../lib/api";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const url = new URL(request.url);
    const query = listCampaignsQuerySchema.safeParse({
      clientId: url.searchParams.get("clientId") ?? undefined,
      marketId: url.searchParams.get("marketId") ?? undefined,
      active: url.searchParams.get("active") ?? undefined,
    });

    if (!query.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: query.error.flatten() },
        { status: 400 },
      );
    }

    const campaigns = await listCampaigns({
      userId: session.userId,
      query: query.data,
    });

    return NextResponse.json(listCampaignsResponseSchema.parse(campaigns));
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const body = createCampaignRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: body.error.flatten() },
        { status: 400 },
      );
    }

    const campaign = await createCampaign({
      userId: session.userId,
      ...body.data,
    });

    return NextResponse.json(campaignSummarySchema.parse(campaign), { status: 201 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
