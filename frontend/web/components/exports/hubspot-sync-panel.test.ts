import { createElement } from "react";
import type { HubspotImportBatchDetail } from "@scouting-platform/contracts";
import { describe, expect, it, vi } from "vitest";

import { renderToStringAsync } from "../../lib/test-render";

vi.mock("../../lib/hubspot-import-batches-api", () => ({
  createHubspotImportBatch: vi.fn(),
  fetchHubspotImportBatchDetail: vi.fn(),
  fetchHubspotImportBatches: vi.fn(),
  getHubspotImportBatchDownloadUrl: vi.fn(),
  retryHubspotImportBatch: vi.fn(),
  HubspotImportBatchesApiError: class HubspotImportBatchesApiError extends Error {},
}));

import {
  HubspotBatchStatusView,
  HubspotReadinessNotice,
  HubspotSyncPanel,
} from "./hubspot-sync-panel";

const completedWithErrorsBatch: HubspotImportBatchDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  run: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "July creators",
  },
  fileName: "july-creators.csv",
  schemaVersion: "week7-hubspot-import-v2",
  status: "completed_with_errors",
  totalRowCount: 2,
  preparedRowCount: 2,
  failedRowCount: 1,
  syncedRowCount: 1,
  deliveryMode: "direct_object_api",
  lastError: null,
  requestedBy: {
    id: "33333333-3333-4333-8333-333333333333",
    email: "admin@example.com",
    name: "Admin",
  },
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:02:00.000Z",
  startedAt: "2026-07-20T10:00:05.000Z",
  completedAt: "2026-07-20T10:02:00.000Z",
  rows: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      channelId: "55555555-5555-4555-8555-555555555555",
      channelTitle: "Creator One",
      contactEmail: "one@example.com",
      firstName: "Creator",
      lastName: "One",
      influencerType: "Creator",
      influencerVertical: "Gaming",
      countryRegion: "Croatia",
      language: "English",
      status: "synced",
      errorMessage: null,
      hubspotContactId: "101",
      hubspotDealId: "202",
      hubspotContactUrl: "https://app.hubspot.com/contacts/123/record/0-1/101",
      hubspotDealUrl: "https://app.hubspot.com/contacts/123/record/0-3/202",
      associationStatus: "associated",
      retryable: false,
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T10:01:00.000Z",
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      channelId: "77777777-7777-4777-8777-777777777777",
      channelTitle: "Creator Two",
      contactEmail: "two@example.com",
      firstName: "Creator",
      lastName: "Two",
      influencerType: "Creator",
      influencerVertical: "Travel",
      countryRegion: "Croatia",
      language: "English",
      status: "failed",
      errorMessage: "HubSpot rejected the pipeline stage.",
      associationStatus: "pending",
      retryable: true,
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T10:02:00.000Z",
    },
  ],
};

describe("HubspotSyncPanel", () => {
  it("makes direct sync primary and names the durable CSV fallback", async () => {
    const html = await renderToStringAsync(
      createElement(HubspotSyncPanel, {
        runId: "22222222-2222-4222-8222-222222222222",
        hasPendingChanges: false,
        isSaving: false,
        validationIssueCount: 0,
      }),
    );

    expect(html).toContain("Sync to HubSpot");
    expect(html).toContain("Download HubSpot CSV");
    expect(html).toContain("Loading HubSpot delivery history");
    expect(html).not.toContain("Push contacts to HubSpot");
  });

  it("blocks delivery until edits and validation issues are resolved", async () => {
    const html = await renderToStringAsync(
      createElement(HubspotSyncPanel, {
        runId: "22222222-2222-4222-8222-222222222222",
        hasPendingChanges: true,
        isSaving: false,
        validationIssueCount: 2,
      }),
    );

    expect(html).toContain("Save your edits before starting a HubSpot delivery");
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("shows partial failures, failed-row retry and durable CRM links", async () => {
    const html = await renderToStringAsync(
      createElement(HubspotBatchStatusView, {
        batch: completedWithErrorsBatch,
        operation: null,
        onRetryFailedRows: vi.fn(),
      }),
    );
    const textHtml = html.replaceAll("<!-- -->", "");

    expect(textHtml).toContain("Completed with errors");
    expect(textHtml).toContain("1 failed row can be retried");
    expect(textHtml).toContain("Retry failed rows");
    expect(textHtml).toContain("Successful records will not be resubmitted");
    expect(textHtml).toContain("HubSpot rejected the pipeline stage");
    expect(html).toContain("https://app.hubspot.com/contacts/123/record/0-1/101");
    expect(html).toContain("https://app.hubspot.com/contacts/123/record/0-3/202");
  });

  it("names the required CRM graph after a completed direct sync", async () => {
    const html = await renderToStringAsync(
      createElement(HubspotBatchStatusView, {
        batch: {
          ...completedWithErrorsBatch,
          status: "completed",
          failedRowCount: 0,
          syncedRowCount: 2,
          providerResultSummary: {
            dealClientAssociation: { status: "confirmed" },
          },
          rows: completedWithErrorsBatch.rows.map((row) => ({
            ...row,
            status: "synced" as const,
            associationStatus: "associated" as const,
            errorMessage: null,
          })),
        },
        operation: null,
        onRetryFailedRows: vi.fn(),
      }),
    );

    expect(html.replaceAll("<!-- -->", "")).toContain(
      "HubSpot confirmed the Deal → Campaign, Deal → Client, and Campaign → Client associations.",
    );
  });

  it("offers a phase resume when a failed batch still has prepared rows", async () => {
    const interruptedBatch: HubspotImportBatchDetail = {
      ...completedWithErrorsBatch,
      status: "failed",
      failedRowCount: 0,
      syncedRowCount: 0,
      lastError: "Provider transport failed after preparation.",
      rows: completedWithErrorsBatch.rows.map((row) => ({
        ...row,
        status: "prepared" as const,
        retryable: false,
        errorMessage: null,
      })),
    };

    const html = await renderToStringAsync(
      createElement(HubspotBatchStatusView, {
        batch: interruptedBatch,
        operation: null,
        onRetryFailedRows: vi.fn(),
      }),
    );

    expect(html).toContain("The interrupted sync can be resumed");
    expect(html).toContain("Resume sync");
    expect(html).toContain("last durable phase");
  });

  it("shows readiness blockers while keeping the CSV fallback explicit", async () => {
    const html = await renderToStringAsync(
      createElement(HubspotReadinessNotice, {
        error: "",
        isLoading: false,
        readiness: {
          enabled: false,
          ready: false,
          healthStatus: "unknown",
          portalId: null,
          blockers: ["Direct HubSpot sync is disabled."],
          activeBatchId: null,
        },
      }),
    );

    expect(html).toContain("Direct sync is not ready");
    expect(html).toContain("Direct HubSpot sync is disabled");
    expect(html).toContain("CSV remains available");
  });
});
