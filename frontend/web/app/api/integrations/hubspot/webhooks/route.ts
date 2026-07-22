import {
  hubspotWebhookAcceptedResponseSchema,
  hubspotWebhookDeliverySchema,
} from "@scouting-platform/contracts";
import {
  acceptHubspotWebhookDelivery,
  verifyHubspotWebhookRequest,
} from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { toRouteErrorResponse } from "../../../../../lib/api";
import { getHubspotExternalRequestUri } from "../_request-uri";

export const runtime = "nodejs";
const HUBSPOT_WEBHOOK_MAX_RAW_BODY_BYTES = 1024 * 1024;

type RawBodyReadErrorCode =
  | "invalid-content-length"
  | "invalid-encoding"
  | "payload-too-large";

class RawBodyReadError extends Error {
  readonly code: RawBodyReadErrorCode;

  constructor(code: RawBodyReadErrorCode, message: string) {
    super(message);
    this.name = "RawBodyReadError";
    this.code = code;
  }
}

function rawBodyErrorResponse(error: RawBodyReadError): NextResponse {
  if (error.code === "payload-too-large") {
    return NextResponse.json(
      { error: "HubSpot webhook payload is too large" },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      error:
        error.code === "invalid-content-length"
          ? "Invalid Content-Length"
          : "Invalid HubSpot webhook payload",
    },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

function validateDeclaredBodySize(request: Request): void {
  const value = request.headers.get("content-length");

  if (value === null) {
    return;
  }

  if (!/^\d+$/.test(value)) {
    throw new RawBodyReadError(
      "invalid-content-length",
      "Content-Length must contain only decimal digits",
    );
  }

  let declaredBytes: bigint;
  try {
    declaredBytes = BigInt(value);
  } catch {
    throw new RawBodyReadError(
      "invalid-content-length",
      "Content-Length is not a valid integer",
    );
  }

  if (declaredBytes > BigInt(HUBSPOT_WEBHOOK_MAX_RAW_BODY_BYTES)) {
    throw new RawBodyReadError(
      "payload-too-large",
      "Declared HubSpot webhook payload exceeds the raw-body limit",
    );
  }
}

async function readCappedRawBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();

  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > HUBSPOT_WEBHOOK_MAX_RAW_BODY_BYTES) {
        await reader.cancel();
        throw new RawBodyReadError(
          "payload-too-large",
          "Streamed HubSpot webhook payload exceeds the raw-body limit",
        );
      }

      chunks.push(value.slice());
    }
  } finally {
    reader.releaseLock();
  }

  const rawBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    rawBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBytes);
  } catch {
    throw new RawBodyReadError(
      "invalid-encoding",
      "HubSpot webhook payload is not valid UTF-8",
    );
  }
}

/**
 * Auth.js is intentionally not used here. HubSpot signature v3 authenticates
 * the exact external URI and raw body before durable persistence/queueing.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    try {
      validateDeclaredBodySize(request);
    } catch (error) {
      if (error instanceof RawBodyReadError) {
        return rawBodyErrorResponse(error);
      }
      throw error;
    }

    let rawBody: string;
    try {
      rawBody = await readCappedRawBody(request);
    } catch (error) {
      if (error instanceof RawBodyReadError) {
        return rawBodyErrorResponse(error);
      }
      throw error;
    }

    const verified = verifyHubspotWebhookRequest({
      method: request.method,
      uri: getHubspotExternalRequestUri(request),
      rawBody,
      signature: request.headers.get("x-hubspot-signature-v3"),
      timestamp: request.headers.get("x-hubspot-request-timestamp"),
    });

    let decoded: unknown;
    try {
      decoded = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid HubSpot webhook payload" },
        { status: 400 },
      );
    }

    const delivery = hubspotWebhookDeliverySchema.safeParse(decoded);
    if (!delivery.success) {
      return NextResponse.json(
        {
          error: "Invalid HubSpot webhook payload",
          details: delivery.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = await acceptHubspotWebhookDelivery({
      expectedPortalId: verified.portalId,
      events: delivery.data,
    });

    return NextResponse.json(
      hubspotWebhookAcceptedResponseSchema.parse(result),
      {
        status: 202,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
