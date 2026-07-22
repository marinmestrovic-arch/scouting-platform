import { createHubspotV3Signature } from "@scouting-platform/integrations";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  verifyHubspotExtensionRequest,
  verifyHubspotWebhookRequest,
} from "./provider-auth";

const envKeys = [
  "HUBSPOT_ACCESS_TOKEN",
  "HUBSPOT_PORTAL_ID",
  "HUBSPOT_APP_ID",
  "HUBSPOT_CLIENT_SECRET",
  "HUBSPOT_WEBHOOKS_ENABLED",
  "HUBSPOT_UI_EXTENSIONS_ENABLED",
] as const;

describe("HubSpot provider-auth boundary", () => {
  const originalEnvironment = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  const uri = "https://platform.example.com/api/integrations/hubspot/webhooks";
  const secret = "test-client-secret";

  beforeEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = "test-access-token";
    process.env.HUBSPOT_PORTAL_ID = "12345";
    process.env.HUBSPOT_APP_ID = "67890";
    process.env.HUBSPOT_CLIENT_SECRET = secret;
    process.env.HUBSPOT_WEBHOOKS_ENABLED = "true";
    process.env.HUBSPOT_UI_EXTENSIONS_ENABLED = "true";
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnvironment[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  function signedRequest(rawBody: string) {
    const timestamp = String(Date.now());
    return {
      method: "POST",
      uri,
      rawBody,
      timestamp,
      signature: createHubspotV3Signature({
        clientSecret: secret,
        timestamp,
        method: "POST",
        uri,
        rawBody,
      }),
    };
  }

  it("verifies signed webhook requests and returns only configured portal context", () => {
    expect(verifyHubspotWebhookRequest(signedRequest("[]"))).toEqual({
      portalId: "12345",
    });
  });

  it("keeps the app ID distinct when authorizing extension context", () => {
    expect(verifyHubspotExtensionRequest(signedRequest(""))).toEqual({
      portalId: "12345",
      appId: "67890",
    });
  });

  it("fails closed when flags are off or signatures are invalid", () => {
    process.env.HUBSPOT_WEBHOOKS_ENABLED = "false";
    expect(() => verifyHubspotWebhookRequest(signedRequest("[]"))).toThrow(
      expect.objectContaining({ code: "HUBSPOT_WEBHOOKS_DISABLED", status: 404 }),
    );

    process.env.HUBSPOT_WEBHOOKS_ENABLED = "true";
    expect(() =>
      verifyHubspotWebhookRequest({
        ...signedRequest("[]"),
        signature: Buffer.alloc(32).toString("base64"),
      }),
    ).toThrow(
      expect.objectContaining({ code: "HUBSPOT_WEBHOOK_SIGNATURE_INVALID", status: 401 }),
    );
  });
});
