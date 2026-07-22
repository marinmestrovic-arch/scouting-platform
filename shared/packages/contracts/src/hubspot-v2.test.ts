import { describe, expect, it } from "vitest";

import {
  dropdownValueSchema,
  hubspotHealthReportSchema,
  hubspotHealthStateSchema,
  hubspotImportBatchRowSchema,
  hubspotImportBatchSummarySchema,
  hubspotWebhookDeliverySchema,
  jobPayloadSchemas,
} from "./index";

describe("HubSpot V2 contracts", () => {
  it("accepts direct-sync and partial-success batch states", () => {
    const summary = hubspotImportBatchSummarySchema.parse({
      id: "5d7d62a2-b004-4664-9372-24bf4c10633b",
      run: { id: "68e12375-f98e-44ff-80b4-9e6a4b6906a1", name: "Run" },
      fileName: "run.csv",
      schemaVersion: "v2",
      status: "completed_with_errors",
      deliveryMode: "direct_object_api",
      totalRowCount: 2,
      preparedRowCount: 2,
      failedRowCount: 1,
      syncedRowCount: 1,
      lastError: null,
      requestedBy: {
        id: "1e3436d0-66df-49fa-b845-e0c34d8aba87",
        email: "manager@example.com",
        name: "Manager",
      },
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T10:01:00.000Z",
      startedAt: "2026-07-20T10:00:01.000Z",
      completedAt: "2026-07-20T10:01:00.000Z",
    });

    expect(summary.status).toBe("completed_with_errors");
  });

  it("retains row retry and provider identity state", () => {
    const row = hubspotImportBatchRowSchema.parse({
      id: "a2197d69-c9be-4a40-aed6-8c45f15e7e01",
      channelId: "bbb15b9c-fb78-4732-b41b-d53056314f55",
      channelTitle: "Creator",
      contactEmail: "creator@example.com",
      firstName: "Create",
      lastName: "Or",
      influencerType: "Creator",
      influencerVertical: "Tech",
      countryRegion: "HR",
      language: "hr",
      status: "failed",
      errorMessage: "Rate limited",
      retryable: true,
      attemptCount: 2,
      hubspotContactId: "123",
      hubspotDealId: "456",
      associationStatus: "failed",
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T10:01:00.000Z",
    });

    expect(row.retryable).toBe(true);
  });

  it("preserves distinct HubSpot labels and internal values", () => {
    const option = dropdownValueSchema.parse({
      id: "99a8b38c-215d-4aa7-8ed6-96df75b80dd1",
      fieldKey: "dealType",
      value: "Flat Fee",
      label: "Flat Fee",
      internalValue: "influencer_collaboration",
      sourceObjectType: "deals",
      sourcePropertyName: "dealtype",
      hubspotPortalId: "12345",
      hubspotSyncedAt: "2026-07-20T10:00:00.000Z",
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T10:00:00.000Z",
    });

    expect(option.label).not.toBe(option.internalValue);
  });

  it("accepts a safe degraded health report", () => {
    const report = hubspotHealthReportSchema.parse({
      status: "degraded",
      portalId: "12345",
      displayName: "Test portal",
      directSyncEnabled: false,
      webhooksEnabled: false,
      checkedAt: "2026-07-20T10:00:00.000Z",
      lastReferenceSyncAt: null,
      lastObjectSyncAt: null,
      lastWebhookProcessedAt: null,
      checks: [{ code: "contact.unique", label: "Contact ID", status: "fail", message: "Missing" }],
      blockers: ["Missing contact unique property"],
      requiredActions: ["Create atlas_contact_id"],
      lastError: null,
    });

    expect(report.blockers).toHaveLength(1);
  });

  it("exposes durable queued health-check state for polling", () => {
    const state = hubspotHealthStateSchema.parse({
      status: "unknown",
      portalId: null,
      displayName: null,
      directSyncEnabled: false,
      webhooksEnabled: false,
      checkedAt: null,
      lastReferenceSyncAt: null,
      lastObjectSyncAt: null,
      lastWebhookProcessedAt: null,
      checks: [
        {
          code: "saved-health",
          label: "Saved health report",
          status: "skipped",
          message: "No saved check yet",
        },
      ],
      blockers: [],
      requiredActions: ["Run the HubSpot connection health check"],
      lastError: null,
      latestRun: {
        id: "1f902fce-8ae0-49a4-937f-45d30619e5c1",
        status: "queued",
        queuedAt: "2026-07-20T10:00:00.000Z",
        startedAt: null,
        completedAt: null,
        lastError: null,
      },
    });
    const payload = jobPayloadSchemas["hubspot.health-check"].parse({
      healthCheckRunId: state.latestRun?.id,
      requestedByUserId: "1e3436d0-66df-49fa-b845-e0c34d8aba87",
    });

    expect(state.latestRun?.status).toBe("queued");
    expect(payload.healthCheckRunId).toBe(state.latestRun?.id);
  });

  it("validates webhook deliveries and their durable job payload", () => {
    const events = hubspotWebhookDeliverySchema.parse([
      {
        eventId: 12,
        subscriptionId: 34,
        portalId: 56,
        occurredAt: 1_753_000_000_000,
        subscriptionType: "contact.propertyChange",
        objectId: 78,
        propertyName: "email",
        propertyValue: "creator@example.com",
      },
    ]);
    const job = jobPayloadSchemas["hubspot.webhook.process"].parse({
      webhookEventId: "1f902fce-8ae0-49a4-937f-45d30619e5c1",
    });

    expect(events[0]?.portalId).toBe("56");
    expect(job.webhookEventId).toBeTruthy();
  });

  it("normalizes the object type ID on current generic webhook deliveries", () => {
    const events = hubspotWebhookDeliverySchema.parse([
      {
        eventId: 90,
        subscriptionId: 91,
        portalId: 92,
        occurredAt: 1_753_000_000_000,
        subscriptionType: "object.propertyChange",
        objectTypeId: "0-1",
        objectId: 93,
        propertyName: "email",
      },
    ]);

    expect(events[0]).toMatchObject({
      eventId: "90",
      portalId: "92",
      objectTypeId: "0-1",
      objectId: "93",
    });
  });
});
