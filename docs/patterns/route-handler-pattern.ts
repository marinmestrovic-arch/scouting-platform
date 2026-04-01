// @ts-nocheck
/**
 * Route Handler Pattern
 *
 * This pattern mirrors the current route shape in this repo.
 * Copy and adapt it for new handlers.
 *
 * Requirements enforced:
 * 1. Server-side auth via requireAuthenticatedSession/requireAdminSession
 * 2. Param/body validation with zod and shared contract schemas
 * 3. Business logic delegated to @scouting-platform/core
 * 4. Privileged audit logging handled in the core service transaction
 * 5. Errors normalized with toRouteErrorResponse
 *
 * Example location:
 * frontend/web/app/api/admin/channels/[id]/manual-overrides/route.ts
 */

import {
  patchChannelManualOverridesRequestSchema,
  patchChannelManualOverridesResponseSchema,
} from "@scouting-platform/contracts";
import { patchChannelManualOverrides } from "@scouting-platform/core";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession, toRouteErrorResponse } from "../../../../../../lib/api";

// ============================================================================
// 1. PARAM VALIDATION
// Validate route params explicitly instead of trusting context.params.
// ============================================================================

const paramsSchema = z.object({
  id: z.uuid(),
});

// ============================================================================
// 2. ROUTE HANDLER
// Keep the route thin: auth, validation, call core, return response.
// ============================================================================

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // -------------------------------------------------------------------------
  // STEP 1: Authenticate + authorize
  // Admin-only routes should use requireAdminSession().
  // Non-admin routes usually use requireAuthenticatedSession().
  // -------------------------------------------------------------------------
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    // -----------------------------------------------------------------------
    // STEP 2: Validate params
    // -----------------------------------------------------------------------
    const params = paramsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json({ error: "Invalid channel id" }, { status: 400 });
    }

    // -----------------------------------------------------------------------
    // STEP 3: Parse + validate body
    // Use shared contract schemas when they already exist.
    // -----------------------------------------------------------------------
    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const body = patchChannelManualOverridesRequestSchema.safeParse(rawBody);

    if (!body.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: body.error.flatten(),
        },
        { status: 400 },
      );
    }

    // -----------------------------------------------------------------------
    // STEP 4: Delegate to core
    // Core services own business rules, Prisma writes, and audit logging.
    // -----------------------------------------------------------------------
    const result = await patchChannelManualOverrides({
      channelId: params.data.id,
      actorUserId: admin.userId,
      operations: body.data.operations,
    });

    // -----------------------------------------------------------------------
    // STEP 5: Validate outbound response
    // Validate the service result before returning it from the route.
    // -----------------------------------------------------------------------
    const payload = patchChannelManualOverridesResponseSchema.parse(result);

    return NextResponse.json(payload);
  } catch (error) {
    // -----------------------------------------------------------------------
    // STEP 6: Normalize errors
    // Let ServiceError map to status/message; hide unexpected failures.
    // -----------------------------------------------------------------------
    return toRouteErrorResponse(error);
  }
}

// ============================================================================
// PATTERN CHECKLIST
// ============================================================================
//
// Before merging a new route handler, verify:
//
// □ Uses requireAuthenticatedSession() or requireAdminSession()
// □ Params validated with zod
// □ Body validated with shared contract schema or local zod schema
// □ Route delegates writes/business rules to @scouting-platform/core
// □ Privileged mutation records audit event in the core service
// □ Invalid params/body return 400 with the repo's JSON error shape
// □ Expected failures go through toRouteErrorResponse()
// □ Integration test covers happy path + auth failure + validation failure
//
// ============================================================================
