import {
  HubspotConfigError,
  HubspotWebhookSignatureError,
  loadHubspotConfig,
  validateHubspotV3Signature,
} from "@scouting-platform/integrations";

import { ServiceError } from "../errors";

type SignedHubspotRequest = Readonly<{
  method: string;
  uri: string;
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
}>;

function toSafeServiceError(error: unknown): never {
  if (error instanceof HubspotWebhookSignatureError) {
    throw new ServiceError(error.code, error.status, error.message);
  }
  if (error instanceof HubspotConfigError) {
    throw new ServiceError(error.code, 500, error.message);
  }
  throw error;
}

function verifySignature(input: SignedHubspotRequest, clientSecret: string | null): void {
  try {
    validateHubspotV3Signature({
      clientSecret: clientSecret ?? "",
      signature: input.signature,
      timestamp: input.timestamp,
      method: input.method,
      uri: input.uri,
      rawBody: input.rawBody,
    });
  } catch (error) {
    toSafeServiceError(error);
  }
}

export function verifyHubspotWebhookRequest(
  input: SignedHubspotRequest,
): Readonly<{ portalId: string }> {
  try {
    const config = loadHubspotConfig();
    if (!config.featureFlags.webhooks) {
      throw new ServiceError(
        "HUBSPOT_WEBHOOKS_DISABLED",
        404,
        "HubSpot webhook processing is disabled",
      );
    }
    if (!config.portalId) {
      throw new ServiceError(
        "HUBSPOT_PORTAL_ID_MISSING",
        500,
        "HUBSPOT_PORTAL_ID is required for webhook processing",
      );
    }
    verifySignature(input, config.clientSecret);
    return { portalId: config.portalId };
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    return toSafeServiceError(error);
  }
}

export function verifyHubspotExtensionRequest(
  input: SignedHubspotRequest,
): Readonly<{ portalId: string; appId: string }> {
  try {
    const config = loadHubspotConfig();
    if (!config.featureFlags.uiExtensions) {
      throw new ServiceError(
        "HUBSPOT_UI_EXTENSIONS_DISABLED",
        404,
        "HubSpot UI extensions are disabled",
      );
    }
    if (!config.portalId || !config.appId) {
      throw new ServiceError(
        "HUBSPOT_EXTENSION_CONTEXT_MISSING",
        500,
        "HubSpot portal and application IDs are required for UI extensions",
      );
    }
    verifySignature(input, config.clientSecret);
    return { portalId: config.portalId, appId: config.appId };
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    return toSafeServiceError(error);
  }
}
