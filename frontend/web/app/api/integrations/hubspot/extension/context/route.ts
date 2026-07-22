import {
  hubspotExtensionContextQuerySchema,
  hubspotExtensionContextResponseSchema,
} from "@scouting-platform/contracts";
import {
  getHubspotExtensionContext,
  verifyHubspotExtensionRequest,
} from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { toRouteErrorResponse } from "../../../../../../lib/api";
import { getHubspotExternalRequestUri } from "../../_request-uri";

export const runtime = "nodejs";

const numericHubspotIdPattern = /^\d+$/;

/**
 * Auth.js is intentionally not used here. hubspot.fetch signs the request and
 * supplies the portal, user, app, and CRM object context validated below.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const verified = verifyHubspotExtensionRequest({
      method: request.method,
      uri: getHubspotExternalRequestUri(request),
      rawBody: "",
      signature: request.headers.get("x-hubspot-signature-v3"),
      timestamp: request.headers.get("x-hubspot-request-timestamp"),
    });

    const query = hubspotExtensionContextQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) {
      return NextResponse.json(
        {
          error: "Invalid HubSpot extension context",
          details: query.error.flatten(),
        },
        { status: 400 },
      );
    }

    if (
      !numericHubspotIdPattern.test(query.data.portalId) ||
      !numericHubspotIdPattern.test(query.data.userId) ||
      !numericHubspotIdPattern.test(query.data.appId) ||
      !numericHubspotIdPattern.test(query.data.objectId)
    ) {
      return NextResponse.json(
        { error: "Invalid HubSpot extension context" },
        { status: 400 },
      );
    }

    if (
      query.data.portalId !== verified.portalId ||
      query.data.appId !== verified.appId
    ) {
      return NextResponse.json(
        { error: "HubSpot extension context is not authorized" },
        { status: 403 },
      );
    }

    const platformBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (!platformBaseUrl) {
      return NextResponse.json(
        { error: "HubSpot extension context is not configured" },
        { status: 500 },
      );
    }

    const result = await getHubspotExtensionContext({
      portalId: query.data.portalId,
      userEmail: query.data.userEmail,
      objectId: query.data.objectId,
      objectType: query.data.objectType,
      platformBaseUrl,
    });

    return NextResponse.json(hubspotExtensionContextResponseSchema.parse(result), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
