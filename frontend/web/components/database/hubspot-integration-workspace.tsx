"use client";

import type {
  HubspotConflict,
  HubspotHealthCheck,
  HubspotHealthCheckRunStatus,
  HubspotHealthState,
} from "@scouting-platform/contracts";
import React, { useEffect, useState } from "react";

import {
  fetchHubspotConflicts,
  type HubspotConflictFilter,
} from "../../lib/hubspot-conflicts-api";
import {
  fetchHubspotHealth,
  requestHubspotHealthCheck,
} from "../../lib/hubspot-health-api";

export const HUBSPOT_HEALTH_POLL_INTERVAL_MS = 2_000;

export function isHubspotHealthCheckActive(
  status: HubspotHealthCheckRunStatus | null | undefined,
): boolean {
  return status === "queued" || status === "running";
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function checkStatusLabel(status: HubspotHealthCheck["status"]): string {
  switch (status) {
    case "pass":
      return "Pass";
    case "warning":
      return "Warning";
    case "fail":
      return "Failed";
    case "skipped":
      return "Skipped";
  }
}

function conflictEntityLabel(conflict: HubspotConflict): string {
  return conflict.localEntityLabel ?? `${conflict.localEntityType} ${conflict.localEntityId}`;
}

export function HubspotIntegrationWorkspace() {
  const [health, setHealth] = useState<HubspotHealthState | null>(null);
  const [healthError, setHealthError] = useState("");
  const [isRequestingHealth, setIsRequestingHealth] = useState(false);
  const [conflicts, setConflicts] = useState<HubspotConflict[]>([]);
  const [conflictFilter, setConflictFilter] = useState<HubspotConflictFilter>("open");
  const [conflictsError, setConflictsError] = useState("");
  const [isLoadingConflicts, setIsLoadingConflicts] = useState(true);
  const latestHealthRunId = health?.latestRun?.id ?? null;
  const latestHealthRunStatus = health?.latestRun?.status ?? null;

  useEffect(() => {
    const controller = new AbortController();

    void fetchHubspotHealth(controller.signal)
      .then(setHealth)
      .catch((error) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setHealthError(error instanceof Error ? error.message : "Unable to load HubSpot health.");
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!latestHealthRunId || !isHubspotHealthCheckActive(latestHealthRunStatus)) {
      return;
    }

    const controller = new AbortController();
    let requestInFlight = false;
    const interval = globalThis.setInterval(() => {
      if (requestInFlight) {
        return;
      }

      requestInFlight = true;
      void fetchHubspotHealth(controller.signal)
        .then((state) => {
          setHealth(state);
          setHealthError("");
        })
        .catch((error) => {
          if (!(error instanceof Error && error.name === "AbortError")) {
            setHealthError(
              error instanceof Error ? error.message : "Unable to poll HubSpot health.",
            );
          }
        })
        .finally(() => {
          requestInFlight = false;
        });
    }, HUBSPOT_HEALTH_POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      globalThis.clearInterval(interval);
    };
  }, [latestHealthRunId, latestHealthRunStatus]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingConflicts(true);
    setConflictsError("");
    setConflicts([]);

    void fetchHubspotConflicts(conflictFilter, controller.signal)
      .then(setConflicts)
      .catch((error) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setConflictsError(error instanceof Error ? error.message : "Unable to load HubSpot conflicts.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingConflicts(false);
        }
      });

    return () => controller.abort();
  }, [conflictFilter]);

  async function handleHealthCheck() {
    setIsRequestingHealth(true);
    setHealthError("");

    try {
      setHealth(await requestHubspotHealthCheck());
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : "Unable to check HubSpot health.");

      try {
        setHealth(await fetchHubspotHealth());
      } catch {
        // Preserve the actionable enqueue error when refreshing persisted state also fails.
      }
    } finally {
      setIsRequestingHealth(false);
    }
  }

  const healthRunActive = isHubspotHealthCheckActive(health?.latestRun?.status);
  const isCheckingHealth = isRequestingHealth || healthRunActive;

  return (
    <div className="hubspot-admin">
      <section className="hubspot-admin__section" aria-labelledby="hubspot-health-title">
        <div className="database-records__header">
          <div>
            <p className="workspace-eyebrow">Read-only diagnostics</p>
            <h2 id="hubspot-health-title">Connection health</h2>
            <p className="workspace-copy">
              Validate portal identity, required schemas, references and recent synchronization activity.
            </p>
          </div>
          <button
            className="database-records__cta"
            disabled={isCheckingHealth}
            onClick={() => void handleHealthCheck()}
            type="button"
          >
            {isCheckingHealth ? "Checking..." : "Run health check"}
          </button>
        </div>

        {healthError ? <p className="workspace-callout workspace-callout--error" role="alert">{healthError}</p> : null}

        {healthRunActive ? (
          <p className="workspace-copy" role="status">
            {health?.latestRun?.status === "queued"
              ? "Health check queued. Waiting for the worker..."
              : "Health check running in the background..."}
          </p>
        ) : health?.latestRun?.status === "failed" ? (
          <p className="workspace-callout workspace-callout--error" role="alert">
            Health check failed: {health.latestRun.lastError ?? "Unknown worker error"}
          </p>
        ) : null}

        {health ? (
          <div className="hubspot-admin__health">
            <div className="hubspot-admin__health-summary">
              <div>
                <span>Status</span>
                <strong className={`hubspot-admin__health-status hubspot-admin__health-status--${health.status}`}>
                  {health.status}
                </strong>
              </div>
              <div>
                <span>Portal</span>
                <strong>{health.displayName ?? health.portalId ?? "Not connected"}</strong>
                {health.displayName && health.portalId ? <small>ID {health.portalId}</small> : null}
              </div>
              <div>
                <span>Direct sync</span>
                <strong>{health.directSyncEnabled ? "Enabled" : "Disabled"}</strong>
              </div>
              <div>
                <span>Webhooks</span>
                <strong>{health.webhooksEnabled ? "Enabled" : "Disabled"}</strong>
              </div>
              <div>
                <span>Checked</span>
                <strong>{formatTimestamp(health.checkedAt)}</strong>
              </div>
            </div>

            {health.blockers.length > 0 || health.requiredActions.length > 0 ? (
              <div className="hubspot-admin__actions-needed">
                <h3>Action required</h3>
                <ul>
                  {[...health.blockers, ...health.requiredActions].map((action, index) => (
                    <li key={`${action}-${index}`}>{action}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {health.lastError ? (
              <p className="workspace-callout workspace-callout--error" role="alert">
                Last health-check error: {health.lastError}
              </p>
            ) : null}

            <div className="hubspot-admin__checks">
              {health.checks.map((check) => (
                <article key={check.code}>
                  <div>
                    <strong>{check.label}</strong>
                    <span>{check.message}</span>
                  </div>
                  <span className={`hubspot-admin__check-status hubspot-admin__check-status--${check.status}`}>
                    {checkStatusLabel(check.status)}
                  </span>
                </article>
              ))}
            </div>

            <dl className="hubspot-admin__timestamps">
              <div><dt>Reference sync</dt><dd>{formatTimestamp(health.lastReferenceSyncAt)}</dd></div>
              <div><dt>Object sync</dt><dd>{formatTimestamp(health.lastObjectSyncAt)}</dd></div>
              <div><dt>Webhook processed</dt><dd>{formatTimestamp(health.lastWebhookProcessedAt)}</dd></div>
            </dl>
          </div>
        ) : healthError ? null : (
          <p className="workspace-copy" role="status">Loading the last saved health report...</p>
        )}
      </section>

      <section className="hubspot-admin__section" aria-labelledby="hubspot-conflicts-title">
        <div className="database-records__header">
          <div>
            <p className="workspace-eyebrow">Reconciliation</p>
            <h2 id="hubspot-conflicts-title">Field conflicts</h2>
            <p className="workspace-copy">
              Shared-field disagreements are recorded for review instead of overwriting canonical platform data.
            </p>
          </div>
          <label className="hubspot-admin__filter">
            <span>Status</span>
            <select
              onChange={(event) => setConflictFilter(event.currentTarget.value as HubspotConflictFilter)}
              value={conflictFilter}
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>

        {conflictsError ? <p className="workspace-callout workspace-callout--error" role="alert">{conflictsError}</p> : null}
        {isLoadingConflicts ? (
          <p className="workspace-copy" role="status">Loading conflicts...</p>
        ) : conflicts.length === 0 ? (
          <div className="hubspot-admin__empty">
            <strong>No {conflictFilter === "all" ? "" : `${conflictFilter} `}conflicts</strong>
            <p>New disagreements detected by webhooks or reconciliation will appear here.</p>
          </div>
        ) : (
          <div className="hubspot-admin__conflicts">
            <table>
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Property</th>
                  <th>Platform</th>
                  <th>HubSpot</th>
                  <th>Ownership</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((conflict) => (
                  <tr key={conflict.id}>
                    <td>
                      {conflict.hubspotObjectUrl ? (
                        <a href={conflict.hubspotObjectUrl} rel="noreferrer" target="_blank">
                          {conflictEntityLabel(conflict)}
                        </a>
                      ) : conflictEntityLabel(conflict)}
                      <span>{formatTimestamp(conflict.detectedAt)}</span>
                    </td>
                    <td>{conflict.propertyName}</td>
                    <td>{conflict.localValue ?? "Empty"}</td>
                    <td>{conflict.hubspotValue ?? "Empty"}</td>
                    <td>{conflict.ownership}</td>
                    <td>
                      {conflict.status}
                      {conflict.resolvedAt ? (
                        <span>
                          {formatTimestamp(conflict.resolvedAt)}
                          {conflict.resolution ? ` — ${conflict.resolution}` : ""}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
