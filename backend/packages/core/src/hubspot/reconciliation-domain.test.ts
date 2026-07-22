import { describe, expect, it } from "vitest";

import {
  buildHubspotWebhookDedupeKey,
  getHubspotIncrementalCursorStart,
  getHubspotReconciliationAction,
  shouldApplyHubspotObservation,
} from "./reconciliation-domain";

describe("HubSpot reconciliation domain rules", () => {
  const event = {
    eventId: "42",
    subscriptionId: "7",
    portalId: "123",
    occurredAt: 1_721_476_800_000,
    subscriptionType: "contact.propertyChange",
    objectId: "99",
    propertyName: "email",
    propertyValue: "creator@example.com",
  } as const;

  it("derives deterministic keys from stable event content", () => {
    expect(buildHubspotWebhookDedupeKey(event)).toBe(
      buildHubspotWebhookDedupeKey({ ...event }),
    );
    const withoutEventId = { ...event, eventId: undefined };
    expect(buildHubspotWebhookDedupeKey(withoutEventId)).toBe(
      buildHubspotWebhookDedupeKey({ ...withoutEventId }),
    );
  });

  it("does not trust a reused provider event ID as a unique delivery identity", () => {
    const originalKey = buildHubspotWebhookDedupeKey(event);

    expect(buildHubspotWebhookDedupeKey({ ...event, attemptNumber: 1 })).toBe(
      originalKey,
    );
    expect(
      buildHubspotWebhookDedupeKey({ ...event, propertyName: "firstname" }),
    ).not.toBe(originalKey);
    expect(
      buildHubspotWebhookDedupeKey({ ...event, objectId: "100" }),
    ).not.toBe(originalKey);
    expect(
      buildHubspotWebhookDedupeKey({ ...event, occurredAt: event.occurredAt + 1 }),
    ).not.toBe(originalKey);
    expect(
      buildHubspotWebhookDedupeKey({ ...event, portalId: "124" }),
    ).not.toBe(originalKey);
  });

  it("canonicalizes structured property values and merge ID ordering", () => {
    const structuredEvent = {
      ...event,
      propertyValue: { alpha: 1, nested: { first: true, second: false } },
      mergedObjectIds: ["102", "101"],
    };

    expect(buildHubspotWebhookDedupeKey(structuredEvent)).toBe(
      buildHubspotWebhookDedupeKey({
        ...structuredEvent,
        propertyValue: { nested: { second: false, first: true }, alpha: 1 },
        mergedObjectIds: ["101", "102"],
      }),
    );
  });

  it("overlaps incremental cursors to tolerate late observations", () => {
    expect(
      getHubspotIncrementalCursorStart(new Date("2026-07-20T12:00:00.000Z"))?.toISOString(),
    ).toBe("2026-07-20T11:55:00.000Z");
  });

  it("ignores out-of-order observations", () => {
    expect(
      shouldApplyHubspotObservation({
        occurredAt: new Date("2026-07-20T11:59:00.000Z"),
        lastObservedAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("never deactivates a record merely because a response omitted it", () => {
    expect(
      getHubspotReconciliationAction({
        explicitlyArchived: false,
        seenInResponse: false,
      }),
    ).toBe("ignore");
    expect(
      getHubspotReconciliationAction({
        explicitlyArchived: true,
        seenInResponse: true,
      }),
    ).toBe("deactivate");
  });
});
