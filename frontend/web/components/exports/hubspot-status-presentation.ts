import type { HubspotImportBatchStatus } from "@scouting-platform/contracts";

const ACTIVE_HUBSPOT_IMPORT_BATCH_STATUSES = new Set<HubspotImportBatchStatus>([
  "queued",
  "preparing",
  "running",
  "submitting",
  "submitted",
  "processing",
]);

const HUBSPOT_IMPORT_BATCH_STATUS_LABELS: Record<HubspotImportBatchStatus, string> = {
  queued: "Queued",
  preparing: "Preparing records",
  running: "Preparing records",
  submitting: "Submitting to HubSpot",
  submitted: "Submitted to HubSpot",
  processing: "Finalizing associations",
  completed: "Completed",
  completed_with_errors: "Completed with errors",
  failed: "Failed",
};

export function isActiveHubspotImportBatchStatus(
  status: HubspotImportBatchStatus,
): boolean {
  return ACTIVE_HUBSPOT_IMPORT_BATCH_STATUSES.has(status);
}

export function formatHubspotImportBatchStatusLabel(
  status: HubspotImportBatchStatus,
): string {
  return HUBSPOT_IMPORT_BATCH_STATUS_LABELS[status];
}
