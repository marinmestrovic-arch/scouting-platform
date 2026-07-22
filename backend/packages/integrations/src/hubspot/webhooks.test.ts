import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  HubspotWebhookSignatureError,
  createHubspotV3Signature,
  decodeHubspotV3SignatureUri,
  validateHubspotV3Signature,
} from "./webhooks";

describe("HubSpot v3 webhook signature validation", () => {
  const nowMs = 1_720_000_000_000;
  const timestamp = String(nowMs - 1000);
  const clientSecret = "test-client-secret";
  const method = "POST";
  const uri = "https%3A%2F%2Fexample.com%2Fapi%2Fhubspot?source=a%2Fb&literal=%252F";
  const rawBody = '[{"eventId":123,"value":"exact body"}]';

  it("accepts a valid signature over the exact method, URI, raw body, and timestamp", () => {
    const signature = createHubspotV3Signature({
      clientSecret,
      timestamp,
      method,
      uri,
      rawBody,
    });

    expect(
      validateHubspotV3Signature({
        clientSecret,
        signature,
        timestamp,
        method,
        uri,
        rawBody,
        nowMs,
      }),
    ).toEqual({ valid: true, timestampMs: Number(timestamp) });
  });

  it("rejects tampered request bodies and URIs", () => {
    const signature = createHubspotV3Signature({
      clientSecret,
      timestamp,
      method,
      uri,
      rawBody,
    });

    for (const tampered of [
      { uri, rawBody: `${rawBody} ` },
      { uri: `${uri}&extra=true`, rawBody },
    ]) {
      expect(() =>
        validateHubspotV3Signature({
          clientSecret,
          signature,
          timestamp,
          method,
          uri: tampered.uri,
          rawBody: tampered.rawBody,
          nowMs,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "HUBSPOT_WEBHOOK_SIGNATURE_INVALID",
        }) as HubspotWebhookSignatureError,
      );
    }
  });

  it("rejects replayed and implausibly future timestamps", () => {
    for (const staleTimestamp of [String(nowMs - 300_001), String(nowMs + 300_001)]) {
      const signature = createHubspotV3Signature({
        clientSecret,
        timestamp: staleTimestamp,
        method,
        uri,
        rawBody,
      });
      expect(() =>
        validateHubspotV3Signature({
          clientSecret,
          signature,
          timestamp: staleTimestamp,
          method,
          uri,
          rawBody,
          nowMs,
        }),
      ).toThrowError(
        expect.objectContaining({ code: "HUBSPOT_WEBHOOK_REPLAYED" }) as HubspotWebhookSignatureError,
      );
    }
  });

  it("rejects missing or malformed headers", () => {
    expect(() =>
      validateHubspotV3Signature({
        clientSecret,
        signature: "not-base64",
        timestamp,
        method,
        uri,
        rawBody,
        nowMs,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "HUBSPOT_WEBHOOK_SIGNATURE_MISSING" }) as HubspotWebhookSignatureError,
    );

    expect(() =>
      validateHubspotV3Signature({
        clientSecret,
        signature: Buffer.alloc(32).toString("base64"),
        timestamp: "not-a-timestamp",
        method,
        uri,
        rawBody,
        nowMs,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "HUBSPOT_WEBHOOK_TIMESTAMP_INVALID" }) as HubspotWebhookSignatureError,
    );
  });

  it("decodes only HubSpot's documented URI characters and preserves literal query delimiters", () => {
    expect(
      decodeHubspotV3SignatureUri(
        "https%3a%2f%2fexample.com%2Fhook%3Fx%3D1?literal=true&encoded=%252F&space=%20",
      ),
    ).toBe("https://example.com/hook?x%3D1?literal=true&encoded=%252F&space=%20");

    const exactSource = `${method}https://example.com/hook?x=1${rawBody}${timestamp}`;
    const broadDecodedSignature = createHmac("sha256", clientSecret)
      .update(exactSource)
      .digest("base64");
    expect(broadDecodedSignature).not.toBe(
      createHubspotV3Signature({
        clientSecret,
        timestamp,
        method,
        uri: "https%3A%2F%2Fexample.com%2Fhook%3Fx%3D1",
        rawBody,
      }),
    );
  });
});
