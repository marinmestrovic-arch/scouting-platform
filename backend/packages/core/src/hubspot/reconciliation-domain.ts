import { createHash } from "node:crypto";

import type { HubspotWebhookEventPayload } from "@scouting-platform/contracts";

const DEFAULT_CURSOR_OVERLAP_MS = 5 * 60 * 1_000;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? JSON.stringify(String(value));
}

export function buildHubspotWebhookDedupeKey(
  event: HubspotWebhookEventPayload,
): string {
  // HubSpot does not guarantee eventId uniqueness, while attemptNumber changes
  // across retries. Hash only allowlisted, stable delivery content so exact
  // redeliveries converge without exposing provider payload values in the key.
  const stableEventContent = {
    appId: event.appId ?? null,
    changeSource: event.changeSource ?? null,
    eventId: event.eventId ?? null,
    mergedObjectIds: (event.mergedObjectIds ?? []).slice().sort(),
    newObjectId: event.newObjectId ?? null,
    objectId: event.objectId ?? null,
    objectTypeId: event.objectTypeId ?? null,
    occurredAt: event.occurredAt,
    portalId: event.portalId,
    primaryObjectId: event.primaryObjectId ?? null,
    propertyName: event.propertyName ?? null,
    propertyValue: event.propertyValue === undefined
      ? { present: false }
      : { present: true, value: event.propertyValue },
    subscriptionId: event.subscriptionId,
    subscriptionType: event.subscriptionType,
  };
  const digest = createHash("sha256")
    .update(stableJson(stableEventContent))
    .digest("hex");
  const prefix = event.eventId ? "event" : "derived";

  return `${prefix}:${event.portalId}:${digest}`;
}

export function getHubspotIncrementalCursorStart(
  highWaterMark: Date | null,
  overlapMs = DEFAULT_CURSOR_OVERLAP_MS,
): Date | null {
  if (!highWaterMark) {
    return null;
  }

  return new Date(highWaterMark.getTime() - Math.max(0, overlapMs));
}

export function shouldApplyHubspotObservation(input: {
  occurredAt: Date;
  lastObservedAt: Date | null;
}): boolean {
  return !input.lastObservedAt || input.occurredAt >= input.lastObservedAt;
}

export type ReconciliationAction = "upsert" | "deactivate" | "ignore";

export function getHubspotReconciliationAction(input: {
  explicitlyArchived: boolean;
  seenInResponse: boolean;
}): ReconciliationAction {
  if (input.explicitlyArchived) {
    return "deactivate";
  }

  return input.seenInResponse ? "upsert" : "ignore";
}
