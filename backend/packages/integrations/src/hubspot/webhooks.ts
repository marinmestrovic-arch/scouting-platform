import { createHmac, timingSafeEqual } from "node:crypto";

export const HUBSPOT_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

const HUBSPOT_URI_DECODE_MAP: Readonly<Record<string, string>> = Object.freeze({
  "%3A": ":",
  "%2F": "/",
  "%3F": "?",
  "%40": "@",
  "%21": "!",
  "%24": "$",
  "%27": "'",
  "%28": "(",
  "%29": ")",
  "%2A": "*",
  "%2C": ",",
  "%3B": ";",
});

const HUBSPOT_URI_DECODE_PATTERN = /%3A|%2F|%3F|%40|%21|%24|%27|%28|%29|%2A|%2C|%3B/gi;

export type HubspotWebhookSignatureErrorCode =
  | "HUBSPOT_WEBHOOK_SECRET_MISSING"
  | "HUBSPOT_WEBHOOK_SIGNATURE_MISSING"
  | "HUBSPOT_WEBHOOK_TIMESTAMP_INVALID"
  | "HUBSPOT_WEBHOOK_REPLAYED"
  | "HUBSPOT_WEBHOOK_SIGNATURE_INVALID";

export class HubspotWebhookSignatureError extends Error {
  readonly code: HubspotWebhookSignatureErrorCode;
  readonly status: number;

  constructor(code: HubspotWebhookSignatureErrorCode, message: string) {
    super(message);
    this.name = "HubspotWebhookSignatureError";
    this.code = code;
    this.status = code === "HUBSPOT_WEBHOOK_SECRET_MISSING" ? 500 : 401;
  }
}

export type ValidateHubspotV3SignatureInput = Readonly<{
  clientSecret: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  method: string;
  uri: string;
  rawBody: string;
  nowMs?: number;
  maxAgeMs?: number;
}>;

export type ValidatedHubspotV3Signature = Readonly<{
  valid: true;
  timestampMs: number;
}>;

/** Applies only HubSpot's documented v3 URI substitutions; it is intentionally not decodeURIComponent. */
export function decodeHubspotV3SignatureUri(uri: string): string {
  return uri.replace(HUBSPOT_URI_DECODE_PATTERN, (encoded) => {
    return HUBSPOT_URI_DECODE_MAP[encoded.toUpperCase()] ?? encoded;
  });
}

export function createHubspotV3Signature(input: {
  clientSecret: string;
  timestamp: string;
  method: string;
  uri: string;
  rawBody: string;
}): string {
  const source = `${input.method}${decodeHubspotV3SignatureUri(input.uri)}${input.rawBody}${input.timestamp}`;
  return createHmac("sha256", input.clientSecret).update(source, "utf8").digest("base64");
}

function isValidBase64Sha256(value: string): boolean {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    return false;
  }
  return Buffer.from(value, "base64").length === 32;
}

export function validateHubspotV3Signature(
  input: ValidateHubspotV3SignatureInput,
): ValidatedHubspotV3Signature {
  const clientSecret = input.clientSecret.trim();
  if (!clientSecret) {
    throw new HubspotWebhookSignatureError(
      "HUBSPOT_WEBHOOK_SECRET_MISSING",
      "HubSpot webhook client secret is not configured",
    );
  }

  const signature = input.signature?.trim();
  if (!signature || !isValidBase64Sha256(signature)) {
    throw new HubspotWebhookSignatureError(
      "HUBSPOT_WEBHOOK_SIGNATURE_MISSING",
      "HubSpot webhook signature is missing or malformed",
    );
  }

  const timestamp = input.timestamp?.trim();
  if (!timestamp || !/^\d+$/.test(timestamp)) {
    throw new HubspotWebhookSignatureError(
      "HUBSPOT_WEBHOOK_TIMESTAMP_INVALID",
      "HubSpot webhook timestamp is invalid",
    );
  }
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
    throw new HubspotWebhookSignatureError(
      "HUBSPOT_WEBHOOK_TIMESTAMP_INVALID",
      "HubSpot webhook timestamp is invalid",
    );
  }

  const nowMs = input.nowMs ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? HUBSPOT_SIGNATURE_MAX_AGE_MS;
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new HubspotWebhookSignatureError(
      "HUBSPOT_WEBHOOK_TIMESTAMP_INVALID",
      "HubSpot webhook validation clock is invalid",
    );
  }
  if (Math.abs(nowMs - timestampMs) > maxAgeMs) {
    throw new HubspotWebhookSignatureError(
      "HUBSPOT_WEBHOOK_REPLAYED",
      "HubSpot webhook timestamp is outside the replay window",
    );
  }

  if (!input.method || !input.uri) {
    throw new HubspotWebhookSignatureError(
      "HUBSPOT_WEBHOOK_SIGNATURE_INVALID",
      "HubSpot webhook request metadata is invalid",
    );
  }
  const expected = Buffer.from(
    createHubspotV3Signature({
      clientSecret,
      timestamp,
      method: input.method,
      uri: input.uri,
      rawBody: input.rawBody,
    }),
    "base64",
  );
  const provided = Buffer.from(signature, "base64");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new HubspotWebhookSignatureError(
      "HUBSPOT_WEBHOOK_SIGNATURE_INVALID",
      "HubSpot webhook signature is invalid",
    );
  }

  return { valid: true, timestampMs };
}
