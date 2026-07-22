import { createHash } from "node:crypto";

import { ServiceError } from "../errors";

export const HUBSPOT_CONTACT_EXTERNAL_ID_PROPERTY = "atlas_contact_id" as const;
export const HUBSPOT_DEAL_EXTERNAL_ID_PROPERTY = "atlas_run_id" as const;

export type HubspotFieldOwnership = "platform" | "hubspot" | "shared";

const PLATFORM_OWNED_PROPERTIES = new Set([
  HUBSPOT_CONTACT_EXTERNAL_ID_PROPERTY,
  HUBSPOT_DEAL_EXTERNAL_ID_PROPERTY,
  "youtube_channel_id",
  "youtube_handle",
  "youtube_url",
  "scouting_platform_last_synced_at",
  "scouting_platform_sync_status",
]);

const HUBSPOT_OWNED_PROPERTIES = new Set([
  "hs_object_id",
  "hubspot_owner_id",
  "pipeline",
  "dealstage",
  "dealname",
  "amount",
  "deal_currency_code",
  "closedate",
  "createdate",
  "worked_with",
  "hs_lastmodifieddate",
]);

const SHARED_PROPERTIES = new Set([
  "email",
  "firstname",
  "lastname",
  "phone",
  "influencer_type",
  "influencer_vertical",
  "country_region",
  "language",
]);

function normalizeStableId(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new ServiceError("HUBSPOT_EXTERNAL_ID_EMPTY", 400, `${label} is required`);
  }

  return normalized;
}

export function buildHubspotContactExternalKey(channelContactId: string): string {
  return `contact:${normalizeStableId(channelContactId, "Channel contact ID")}`;
}

export function buildHubspotDealExternalKey(runRequestId: string): string {
  return `run:${normalizeStableId(runRequestId, "Run request ID")}`;
}

export function buildHubspotPreparationHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export function buildHubspotOutboundProperties(input: {
  values: Readonly<Record<string, string | number | boolean | null | undefined>>;
  explicitlyClear?: readonly string[];
}): Record<string, string> {
  const clearProperties = new Set(input.explicitlyClear ?? []);
  const result: Record<string, string> = {};

  for (const [property, value] of Object.entries(input.values)) {
    if (clearProperties.has(property)) {
      result[property] = "";
      continue;
    }

    if (value === null || value === undefined) {
      continue;
    }

    const serialized = String(value).trim();
    if (!serialized) {
      continue;
    }

    result[property] = serialized;
  }

  for (const property of clearProperties) {
    if (!(property in result)) {
      result[property] = "";
    }
  }

  return result;
}

export function classifyHubspotPropertyOwnership(
  propertyName: string,
): HubspotFieldOwnership {
  const normalized = propertyName.trim().toLowerCase();

  if (PLATFORM_OWNED_PROPERTIES.has(normalized)) {
    return "platform";
  }

  if (HUBSPOT_OWNED_PROPERTIES.has(normalized)) {
    return "hubspot";
  }

  if (SHARED_PROPERTIES.has(normalized)) {
    return "shared";
  }

  return "shared";
}

export type HubspotOwnerReference = Readonly<{
  id: string;
  email: string | null;
  active: boolean;
}>;

export type HubspotOwnerResolution =
  | Readonly<{ status: "resolved"; ownerId: string }>
  | Readonly<{ status: "missing" | "ambiguous"; ownerId: null; message: string }>;

export function resolveHubspotOwnerByEmail(
  ownerEmail: string | null | undefined,
  owners: readonly HubspotOwnerReference[],
): HubspotOwnerResolution {
  const normalizedEmail = ownerEmail?.trim().toLowerCase();

  if (!normalizedEmail) {
    return {
      status: "missing",
      ownerId: null,
      message: "A campaign manager email is required to resolve a HubSpot owner",
    };
  }

  const matches = owners.filter(
    (owner) => owner.active && owner.email?.trim().toLowerCase() === normalizedEmail,
  );

  if (matches.length === 1) {
    return {
      status: "resolved",
      ownerId: matches[0]!.id,
    };
  }

  if (matches.length === 0) {
    return {
      status: "missing",
      ownerId: null,
      message: `No active HubSpot owner matches ${normalizedEmail}`,
    };
  }

  return {
    status: "ambiguous",
    ownerId: null,
    message: `More than one active HubSpot owner matches ${normalizedEmail}`,
  };
}

export function resolveHubspotInternalValue(input: {
  displayOrInternalValue: string | null | undefined;
  references: readonly Readonly<{ label: string; internalValue: string }>[];
}): string | null {
  const requested = input.displayOrInternalValue?.trim().toLowerCase();
  if (!requested) {
    return null;
  }

  const matches = input.references.filter(
    (reference) =>
      reference.label.trim().toLowerCase() === requested
      || reference.internalValue.trim().toLowerCase() === requested,
  );

  return matches.length === 1 ? matches[0]!.internalValue : null;
}
