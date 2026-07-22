"use client";

import type {
  HubspotDeliveryMode,
  HubspotImportBatchDetail,
  HubspotImportBatchRow,
  HubspotImportBatchStatus,
  HubspotReadiness,
} from "@scouting-platform/contracts";
import React, { useCallback, useEffect, useState } from "react";

import {
  createHubspotImportBatch,
  fetchHubspotImportBatchDetail,
  fetchHubspotImportBatches,
  getHubspotImportBatchDownloadUrl,
  HubspotImportBatchesApiError,
  retryHubspotImportBatch,
} from "../../lib/hubspot-import-batches-api";
import { fetchHubspotReadiness } from "../../lib/hubspot-readiness-api";
import {
  formatHubspotImportBatchStatusLabel,
  isActiveHubspotImportBatchStatus,
} from "./hubspot-status-presentation";

type HubspotPanelOperation = HubspotDeliveryMode | "retry" | null;

function isActiveStatus(status: HubspotImportBatchStatus): boolean {
  return isActiveHubspotImportBatchStatus(status);
}

function modeLabel(mode: HubspotDeliveryMode | undefined): string {
  return mode === "direct_object_api" ? "Direct HubSpot sync" : "HubSpot CSV fallback";
}

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function associationConfirmed(
  batch: HubspotImportBatchDetail,
  key: string,
): boolean {
  const value = batch.providerResultSummary?.[key];
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && "status" in value
    && value.status === "confirmed";
}

function statusMessage(batch: HubspotImportBatchDetail): string {
  const syncedCount = batch.syncedRowCount ?? 0;
  const dealClientConfirmed = associationConfirmed(batch, "dealClientAssociation");

  switch (batch.status) {
    case "queued":
      return "The durable job is queued. You can leave this page and return later.";
    case "preparing":
    case "running":
      return `Preparing ${batch.totalRowCount} contact record${batch.totalRowCount === 1 ? "" : "s"}.`;
    case "submitting":
      return `Submitting records in retry-safe batches (${syncedCount}/${batch.totalRowCount} synced).`;
    case "submitted":
      return "HubSpot accepted the submission. Waiting for provider results.";
    case "processing":
      return "Contact and deal records are saved. Final associations are being verified.";
    case "completed":
      return batch.deliveryMode === "direct_object_api"
        ? `Synced ${syncedCount || batch.totalRowCount} contact record${batch.totalRowCount === 1 ? "" : "s"} and the run deal. HubSpot confirmed the ${dealClientConfirmed ? "Deal → Campaign, Deal → Client, and Campaign → Client" : "Deal → Campaign and Campaign → Client"} associations.`
        : `Prepared ${batch.preparedRowCount} CSV row${batch.preparedRowCount === 1 ? "" : "s"}.`;
    case "completed_with_errors":
      return `${syncedCount} succeeded and ${batch.failedRowCount} ${batch.failedRowCount === 1 ? "needs" : "need"} attention. Successful records will not be resubmitted.`;
    case "failed":
      return batch.lastError ?? "The batch failed before it could finish.";
  }
}

function rowStatusLabel(row: HubspotImportBatchRow): string {
  switch (row.status) {
    case "pending":
      return "Pending";
    case "prepared":
      return "Prepared";
    case "submitting":
      return "Submitting";
    case "synced":
      return "Synced";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
  }
}

function formatApiError(error: unknown): string {
  if (error instanceof HubspotImportBatchesApiError && error.validation?.blockers.length) {
    const blockers = error.validation.blockers;
    const summary = blockers
      .slice(0, 3)
      .map((blocker) => blocker.message)
      .join(" ");
    const remaining = blockers.length - 3;

    return remaining > 0
      ? `${summary} ${remaining} more blocker${remaining === 1 ? "" : "s"} remain.`
      : summary;
  }

  return error instanceof Error ? error.message : "Unable to update the HubSpot batch.";
}

export function HubspotBatchStatusView({
  batch,
  operation,
  onRetryFailedRows,
}: Readonly<{
  batch: HubspotImportBatchDetail;
  operation: HubspotPanelOperation;
  onRetryFailedRows: () => void;
}>) {
  const retryableRows = batch.rows.filter(
    (row) => row.status === "failed" && row.retryable !== false,
  );
  const resumableRows = batch.rows.filter((row) =>
    ["pending", "prepared", "submitting"].includes(row.status),
  );
  const isPhaseResume =
    batch.status === "failed" && retryableRows.length === 0 && resumableRows.length > 0;
  const canRetry =
    batch.deliveryMode === "direct_object_api" &&
    (batch.status === "completed_with_errors" || batch.status === "failed") &&
    (retryableRows.length > 0 || isPhaseResume);

  return (
    <div className="hubspot-sync-panel__batch" data-status={batch.status}>
      <div className="hubspot-sync-panel__status-header">
        <div>
          <p className="workspace-eyebrow">{modeLabel(batch.deliveryMode)}</p>
          <h3>{formatHubspotImportBatchStatusLabel(batch.status)}</h3>
        </div>
        <span className={`hubspot-sync-panel__status hubspot-sync-panel__status--${batch.status}`}>
          {batch.syncedRowCount ?? batch.preparedRowCount}/{batch.totalRowCount}
        </span>
      </div>
      <p className="workspace-copy">{statusMessage(batch)}</p>
      {batch.updatedAt ? (
        <p className="hubspot-sync-panel__timestamp">Updated {formatTimestamp(batch.updatedAt)}</p>
      ) : null}

      {canRetry ? (
        <div className="hubspot-sync-panel__retry">
          <div>
            <strong>
              {isPhaseResume
                ? "The interrupted sync can be resumed"
                : `${retryableRows.length} failed row${retryableRows.length === 1 ? "" : "s"} can be retried`}
            </strong>
            <p>
              {isPhaseResume
                ? "Resume continues from the last durable phase. Existing contact, deal and association successes are preserved."
                : "Retry sends only failed, retryable rows. Existing contact, deal and association successes are preserved."}
            </p>
          </div>
          <button
            className="workspace-button workspace-button--secondary"
            disabled={operation !== null}
            onClick={onRetryFailedRows}
            type="button"
          >
            {operation === "retry"
              ? "Queueing retry..."
              : isPhaseResume
                ? "Resume sync"
                : "Retry failed rows"}
          </button>
        </div>
      ) : null}

      {batch.rows.length > 0 ? (
        <div className="hubspot-sync-panel__rows">
          <table>
            <thead>
              <tr>
                <th>Creator</th>
                <th>Status</th>
                <th>HubSpot records</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {batch.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.channelTitle}</strong>
                    <span>{row.contactEmail}</span>
                  </td>
                  <td>{rowStatusLabel(row)}</td>
                  <td>
                    <div className="hubspot-sync-panel__record-links">
                      {row.hubspotContactUrl ? (
                        <a href={row.hubspotContactUrl} rel="noreferrer" target="_blank">Contact</a>
                      ) : null}
                      {row.hubspotDealUrl ? (
                        <a href={row.hubspotDealUrl} rel="noreferrer" target="_blank">Deal</a>
                      ) : null}
                      {!row.hubspotContactUrl && !row.hubspotDealUrl ? <span>—</span> : null}
                    </div>
                  </td>
                  <td className={row.errorMessage ? "hubspot-sync-panel__row-error" : undefined}>
                    {row.errorMessage ?? (row.associationStatus === "failed" ? "Association needs retry" : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function HubspotReadinessNotice({
  error,
  isLoading,
  readiness,
}: Readonly<{
  error: string;
  isLoading: boolean;
  readiness: HubspotReadiness | null;
}>) {
  if (isLoading) {
    return <p className="workspace-copy" role="status">Checking HubSpot connection readiness...</p>;
  }

  if (error) {
    return (
      <p className="workspace-callout workspace-callout--error" role="alert">
        {error} Direct sync remains disabled; the CSV fallback is still available.
      </p>
    );
  }

  if (readiness?.activeBatchId) {
    return (
      <p className="database-admin__sync-status" role="status">
        A direct sync for this run is already active. Its durable status is shown below.
      </p>
    );
  }

  if (!readiness || readiness.ready) {
    return null;
  }

  const blockers = readiness.blockers.length > 0
    ? readiness.blockers
    : ["HubSpot connection checks have not completed successfully."];

  return (
    <div className="hubspot-sync-panel__blockers" role="status">
      <strong>Direct sync is not ready</strong>
      <ul>
        {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
      </ul>
      <p>Admins can review full diagnostics in Database → HubSpot. CSV remains available.</p>
    </div>
  );
}

export function HubspotSyncPanel({
  runId,
  hasPendingChanges,
  isSaving,
  validationIssueCount,
}: Readonly<{
  runId: string;
  hasPendingChanges: boolean;
  isSaving: boolean;
  validationIssueCount: number;
}>) {
  const [batch, setBatch] = useState<HubspotImportBatchDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [readiness, setReadiness] = useState<HubspotReadiness | null>(null);
  const [isLoadingReadiness, setIsLoadingReadiness] = useState(true);
  const [readinessError, setReadinessError] = useState("");
  const [operation, setOperation] = useState<HubspotPanelOperation>(null);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  const refreshBatch = useCallback(async (batchId: string, signal?: AbortSignal) => {
    const detail = await fetchHubspotImportBatchDetail(batchId, signal);
    setBatch(detail);
    return detail;
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void fetchHubspotImportBatches(controller.signal)
      .then(async (items) => {
        const runBatches = items.filter((item) => item.run.id === runId);
        const selected = runBatches.find((item) => isActiveStatus(item.status)) ?? runBatches[0];

        if (selected) {
          await refreshBatch(selected.id, controller.signal);
        }
      })
      .catch((error) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setMessage(formatApiError(error));
          setMessageIsError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [refreshBatch, runId]);

  useEffect(() => {
    const controller = new AbortController();

    void fetchHubspotReadiness(runId, controller.signal)
      .then(setReadiness)
      .catch((error) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setReadinessError(
            error instanceof Error ? error.message : "Unable to check HubSpot readiness.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingReadiness(false);
        }
      });

    return () => controller.abort();
  }, [runId]);

  useEffect(() => {
    if (!batch || !isActiveStatus(batch.status)) {
      return;
    }

    const controller = new AbortController();
    const interval = window.setInterval(() => {
      void refreshBatch(batch.id, controller.signal).catch((error) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setMessage(formatApiError(error));
          setMessageIsError(true);
        }
      });
    }, 2500);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [batch, refreshBatch]);

  const active = batch ? isActiveStatus(batch.status) : false;
  const blockedByEdits = hasPendingChanges || isSaving;
  const blockedByValidation = validationIssueCount > 0;
  const controlsDisabled = isLoading || operation !== null || active || blockedByEdits || blockedByValidation;
  const shouldUseFailedRowRetry =
    batch?.deliveryMode === "direct_object_api" &&
    (batch.status === "completed_with_errors" || batch.status === "failed") &&
    batch.rows.some(
      (row) =>
        (row.status === "failed" && row.retryable !== false)
        || (batch.status === "failed"
          && ["pending", "prepared", "submitting"].includes(row.status)),
    );
  const directSyncDisabled =
    controlsDisabled ||
    shouldUseFailedRowRetry ||
    isLoadingReadiness ||
    Boolean(readinessError) ||
    Boolean(readiness?.activeBatchId) ||
    readiness?.ready !== true;
  const canDownloadPreparedCsv =
    batch?.deliveryMode === "csv_fallback" && batch.status === "completed";

  async function createBatch(deliveryMode: HubspotDeliveryMode) {
    if (deliveryMode === "csv_fallback" && canDownloadPreparedCsv && batch) {
      window.location.assign(getHubspotImportBatchDownloadUrl(batch.id));
      return;
    }

    setOperation(deliveryMode);
    setMessageIsError(false);
    setMessage(
      deliveryMode === "direct_object_api"
        ? "Queueing direct HubSpot sync..."
        : "Queueing HubSpot CSV preparation...",
    );

    try {
      const summary = await createHubspotImportBatch({ runId, deliveryMode });
      await refreshBatch(summary.id);
      setMessage(
        summary.reusedActiveBatch
          ? "The existing retry-safe batch is shown below. No duplicate batch was created."
          : "",
      );
    } catch (error) {
      setMessage(formatApiError(error));
      setMessageIsError(true);
    } finally {
      setOperation(null);
    }
  }

  async function retryFailedRows() {
    if (!batch) {
      return;
    }

    setOperation("retry");
    setMessage("Queueing retry or phase resume...");
    setMessageIsError(false);

    try {
      const result = await retryHubspotImportBatch(batch.id);
      await refreshBatch(result.batch.id);
      setMessage(
        `Queued ${result.retriedRowCount} failed row${result.retriedRowCount === 1 ? "" : "s"}. Previously successful records remain unchanged.`,
      );
    } catch (error) {
      setMessage(formatApiError(error));
      setMessageIsError(true);
    } finally {
      setOperation(null);
    }
  }

  return (
    <section className="export-prep__defaults hubspot-sync-panel" aria-labelledby="hubspot-sync-title">
      <div className="database-records__header export-prep__defaults-header">
        <div>
          <p className="workspace-eyebrow">Durable delivery</p>
          <h2 id="hubspot-sync-title">HubSpot sync</h2>
          <p className="workspace-copy">
            Sync this prepared run directly to HubSpot. CSV remains available as a safe fallback.
          </p>
        </div>
        <div className="hubspot-sync-panel__actions">
          <button
            className="database-records__cta"
            disabled={directSyncDisabled}
            onClick={() => void createBatch("direct_object_api")}
            type="button"
          >
            {operation === "direct_object_api" ? "Queueing..." : "Sync to HubSpot"}
          </button>
          <button
            className="workspace-button workspace-button--secondary"
            disabled={canDownloadPreparedCsv ? operation !== null : controlsDisabled}
            onClick={() => void createBatch("csv_fallback")}
            type="button"
          >
            {operation === "csv_fallback" ? "Preparing..." : "Download HubSpot CSV"}
          </button>
        </div>
      </div>

      {blockedByEdits ? (
        <p className="workspace-copy" role="status">
          Save your edits before starting a HubSpot delivery.
        </p>
      ) : blockedByValidation ? (
        <p className="workspace-copy" role="status">
          Resolve {validationIssueCount} required field{validationIssueCount === 1 ? "" : "s"} before delivery.
        </p>
      ) : null}

      <HubspotReadinessNotice
        error={readinessError}
        isLoading={isLoadingReadiness}
        readiness={readiness}
      />

      {message ? (
        <p
          className={messageIsError ? "workspace-callout workspace-callout--error" : "database-admin__sync-status"}
          role={messageIsError ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}

      {isLoading ? (
        <p className="workspace-copy" role="status">Loading HubSpot delivery history...</p>
      ) : batch ? (
        <HubspotBatchStatusView
          batch={batch}
          onRetryFailedRows={() => void retryFailedRows()}
          operation={operation}
        />
      ) : (
        <p className="workspace-copy">No HubSpot delivery has been created for this run yet.</p>
      )}
    </section>
  );
}
