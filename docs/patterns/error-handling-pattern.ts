// @ts-nocheck
/**
 * Error Handling Pattern
 *
 * This pattern mirrors the current error flow in the repo.
 * Use it when wiring expected failures from core -> routes -> workers.
 *
 * Current shape:
 * 1. Core services throw ServiceError for expected failures
 * 2. Route handlers use jsonError()/toRouteErrorResponse()
 * 3. Workers format and persist/log plain string errors for operators
 *
 * Primary locations:
 * backend/packages/core/src/errors.ts
 * frontend/web/lib/api.ts
 */

import { NextResponse } from "next/server";

// ============================================================================
// 1. DOMAIN ERROR
// Throw this from backend/packages/core for expected business failures.
// ============================================================================

export class ServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}

// ============================================================================
// 2. ROUTE HELPERS
// frontend/web/lib/api.ts keeps the route response shape small and consistent.
// ============================================================================

export function jsonError(
  message: string,
  status: number,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    details === undefined ? { error: message } : { error: message, details },
    { status },
  );
}

export function toRouteErrorResponse(error: unknown): NextResponse {
  if (error instanceof ServiceError) {
    return jsonError(error.message, error.status);
  }

  return jsonError("Internal server error", 500);
}

// ============================================================================
// 3. WORKER ERROR FORMATTING
// Workers need compact, operator-readable strings for logs/lastError columns.
// ============================================================================

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

// ============================================================================
// 4. SAFE LOGGING
// Redact sensitive fields before logging request/provider metadata.
// ============================================================================

const SENSITIVE_FIELDS = [
  "password",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
] as const;

export function redactSensitive(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();

      if (SENSITIVE_FIELDS.some((field) => lowerKey.includes(field.toLowerCase()))) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactSensitive(entry);
      }
    }

    return result;
  }

  return value;
}

// ============================================================================
// PATTERN CHECKLIST
// ============================================================================
//
// Before merging error-handling changes, verify:
//
// □ Expected core failures throw ServiceError
// □ Routes convert errors with toRouteErrorResponse()
// □ Route JSON errors use the repo shape: { error: string, details? }
// □ Unexpected failures do not leak internal details to clients
// □ Worker logs/lastError values use formatErrorMessage()
// □ Sensitive metadata is redacted before logging
//
// ============================================================================
