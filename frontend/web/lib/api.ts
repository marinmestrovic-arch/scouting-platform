import { ServiceError } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { auth } from "../auth";

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Wrap a JSON response with short-lived cache headers so the browser (and any
 * CDN) can reuse the response for `maxAge` seconds instead of re-fetching.
 *
 * `stale-while-revalidate` lets clients use a stale response while fetching a
 * fresh one in the background, preventing UI stalls on cache expiry.
 */
export function cachedJson(
  data: unknown,
  { maxAge = 30, swr = 60, status = 200 }: { maxAge?: number; swr?: number; status?: number } = {},
): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": `private, max-age=${maxAge}, stale-while-revalidate=${swr}`,
    },
  });
}

export function toRouteErrorResponse(error: unknown): NextResponse {
  if (error instanceof ServiceError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof Error) {
    return jsonError("Internal server error", 500);
  }

  return jsonError("Internal server error", 500);
}

export async function requireAdminSession(): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const session = await auth();

  if (!session?.user?.id) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  if (session.user.role !== "admin") {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  return { ok: true, userId: session.user.id };
}

export async function requireAuthenticatedSession(): Promise<
  | { ok: true; userId: string; role: "admin" | "user" }
  | { ok: false; response: NextResponse }
> {
  const session = await auth();

  if (!session?.user?.id) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  return {
    ok: true,
    userId: session.user.id,
    role: session.user.role,
  };
}
