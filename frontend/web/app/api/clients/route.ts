import {
  clientSummarySchema,
  createClientRequestSchema,
  listClientsResponseSchema,
} from "@scouting-platform/contracts";
import { createClient, listClients } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { cachedJson, requireAuthenticatedSession, toRouteErrorResponse } from "../../../lib/api";

export async function GET(): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const clients = await listClients({
      userId: session.userId,
    });

    return cachedJson(listClientsResponseSchema.parse(clients), { maxAge: 60 });
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
    const body = createClientRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: body.error.flatten() },
        { status: 400 },
      );
    }

    const client = await createClient({
      userId: session.userId,
      ...body.data,
    });

    return NextResponse.json(clientSummarySchema.parse(client), { status: 201 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
