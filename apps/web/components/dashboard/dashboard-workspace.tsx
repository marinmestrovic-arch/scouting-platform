"use client";

import type { ListRecentRunsResponse } from "@scouting-platform/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import { getDatabaseRunHref } from "../../lib/database-workspace";
import { getCsvExportBatchResultHref, getHubspotPushBatchResultHref } from "../../lib/navigation";
import {
  createCsvExportBatchFromRun,
  createHubspotPushBatchFromRun,
  RunBatchActionError,
} from "../../lib/run-batch-actions";
import { fetchRecentRuns } from "../../lib/runs-api";
import {
  formatRunResultCount,
  formatRunStatusLabel,
  formatRunTimestamp,
  getRunStatusSummary,
  RUN_STATUS_POLL_INTERVAL_MS,
  shouldPollRunStatus,
} from "../runs/run-presentation";

type DashboardRunsRequestState =
  | { status: "loading"; data: null; error: null }
  | { status: "error"; data: null; error: string }
  | { status: "ready"; data: ListRecentRunsResponse; error: null };

type DashboardBatchActionState = {
  action: "csv" | "hubspot" | null;
  runId: string | null;
  status: "idle" | "submitting" | "error";
  message: string;
};

const INITIAL_REQUEST_STATE: DashboardRunsRequestState = {
  status: "loading",
  data: null,
  error: null,
};

const IDLE_ACTION_STATE: DashboardBatchActionState = {
  action: null,
  runId: null,
  status: "idle",
  message: "",
};

function getDashboardRunsErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to load recent scouting runs.";
}

function getDashboardBatchActionErrorMessage(action: "csv" | "hubspot", error: unknown): string {
  if (error instanceof RunBatchActionError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return action === "csv"
    ? "Unable to create the CSV export for this run."
    : "Unable to create the HubSpot batch for this run.";
}

export function DashboardWorkspace() {
  const router = useRouter();
  const [requestState, setRequestState] =
    useState<DashboardRunsRequestState>(INITIAL_REQUEST_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const [actionState, setActionState] = useState<DashboardBatchActionState>(IDLE_ACTION_STATE);

  useEffect(() => {
    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function loadRuns(polling = false) {
      if (!polling) {
        setRequestState(INITIAL_REQUEST_STATE);
      }

      try {
        const recentRuns = await fetchRecentRuns(abortController.signal);

        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "ready",
          data: recentRuns,
          error: null,
        });

        if (recentRuns.items.some((run) => shouldPollRunStatus(run.status))) {
          timeoutId = setTimeout(() => {
            void loadRuns(true);
          }, RUN_STATUS_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "error",
          data: null,
          error: getDashboardRunsErrorMessage(error),
        });
      }
    }

    void loadRuns();

    return () => {
      didCancel = true;
      abortController.abort();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [reloadToken]);

  const liveSummary = useMemo(() => {
    if (requestState.status !== "ready") {
      return {
        totalResults: 0,
        totalRuns: 0,
      };
    }

    return {
      totalRuns: requestState.data.items.length,
      totalResults: requestState.data.items.reduce((sum, run) => sum + run.resultCount, 0),
    };
  }, [requestState]);

  async function handleBatchAction(runId: string, action: "csv" | "hubspot") {
    setActionState({
      action,
      runId,
      status: "submitting",
      message:
        action === "csv"
          ? "Creating CSV export from this run."
          : "Creating HubSpot import batch from this run.",
    });

    try {
      if (action === "csv") {
        const batch = await createCsvExportBatchFromRun(runId);
        router.push(getCsvExportBatchResultHref(batch.id));
        return;
      }

      const batch = await createHubspotPushBatchFromRun(runId);
      router.push(getHubspotPushBatchResultHref(batch.id));
    } catch (error) {
      setActionState({
        action,
        runId,
        status: "error",
        message: getDashboardBatchActionErrorMessage(action, error),
      });
    }
  }

  return (
    <div className="dashboard-workspace">
      <section className="dashboard-workspace__hero">
        <div>
          <p className="workspace-eyebrow">Scouting</p>
          <h2>Dashboard</h2>
          <p className="workspace-copy">
            Weekly planning scaffolds stay visible here, while the live run table below uses the
            current runs API and routes every shortlist back into Database.
          </p>
        </div>

        <div className="dashboard-workspace__hero-actions">
          <Link href="/new-scouting">New scouting</Link>
          <Link className="dashboard-workspace__secondary-link" href="/database">
            Open Database
          </Link>
        </div>
      </section>

      <section className="dashboard-workspace__filters">
        <div className="dashboard-workspace__disabled-field">
          <label>Week</label>
          <select disabled value="planned">
            <option value="planned">Requires campaign planning metadata backend</option>
          </select>
        </div>
        <div className="dashboard-workspace__disabled-field">
          <label>Client</label>
          <select disabled value="planned">
            <option value="planned">Requires client metadata backend</option>
          </select>
        </div>
        <div className="dashboard-workspace__disabled-field">
          <label>Campaign manager</label>
          <select disabled value="planned">
            <option value="planned">Requires campaign manager metadata backend</option>
          </select>
        </div>
      </section>

      <section className="dashboard-workspace__summary-grid">
        <article className="dashboard-workspace__summary-card dashboard-workspace__summary-card--planned">
          <p className="workspace-eyebrow">Selected week</p>
          <h3>Planned</h3>
          <p>Requires backend campaign planning records.</p>
        </article>
        <article className="dashboard-workspace__summary-card dashboard-workspace__summary-card--planned">
          <p className="workspace-eyebrow">Total target</p>
          <h3>Planned</h3>
          <p>Target totals land when campaign targets are stored.</p>
        </article>
        <article className="dashboard-workspace__summary-card dashboard-workspace__summary-card--planned">
          <p className="workspace-eyebrow">Coverage</p>
          <h3>Planned</h3>
          <p>Coverage depends on target metadata that does not exist yet.</p>
        </article>
        <article className="dashboard-workspace__summary-card">
          <p className="workspace-eyebrow">Live today</p>
          <h3>
            {liveSummary.totalRuns} runs · {liveSummary.totalResults} creators
          </h3>
          <p>Recent runs and stored result counts are live from the current API.</p>
        </article>
      </section>

      {actionState.status === "error" ? (
        <section className="workspace-callout workspace-callout--error" role="alert">
          <h3>Run action failed</h3>
          <p>{actionState.message}</p>
        </section>
      ) : null}

      <section className="dashboard-workspace__table-panel">
        <header className="dashboard-workspace__table-header">
          <div>
            <p className="workspace-eyebrow">Run operations</p>
            <h2>Scouting runs</h2>
          </div>
          <button
            className="dashboard-workspace__secondary-link"
            onClick={() => {
              setReloadToken((current) => current + 1);
            }}
            type="button"
          >
            Refresh runs
          </button>
        </header>

        {requestState.status === "loading" ? (
          <div className="dashboard-workspace__feedback" role="status">
            Loading dashboard runs.
          </div>
        ) : null}

        {requestState.status === "error" ? (
          <div className="dashboard-workspace__feedback dashboard-workspace__feedback--error" role="alert">
            <p>{requestState.error}</p>
          </div>
        ) : null}

        {requestState.status === "ready" ? (
          requestState.data.items.length > 0 ? (
            <div className="dashboard-workspace__table-shell">
              <table className="dashboard-workspace__table">
                <thead>
                  <tr>
                    <th>Client and Market</th>
                    <th>Campaign manager</th>
                    <th>Target</th>
                    <th>Influencer List</th>
                    <th>Coverage</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requestState.data.items.map((run) => {
                    const isBusy = actionState.status === "submitting" && actionState.runId === run.id;

                    return (
                      <tr key={run.id}>
                        <td>
                          <div className="dashboard-workspace__planned-cell">
                            <strong>Planned</strong>
                            <span>Needs client and market campaign metadata.</span>
                          </div>
                        </td>
                        <td>
                          <div className="dashboard-workspace__planned-cell">
                            <strong>Planned</strong>
                            <span>Needs campaign manager ownership data.</span>
                          </div>
                        </td>
                        <td>
                          <div className="dashboard-workspace__planned-cell">
                            <strong>Planned</strong>
                            <span>Target creators are not stored by the backend yet.</span>
                          </div>
                        </td>
                        <td>
                          <div className="dashboard-workspace__run-cell">
                            <div>
                              <Link className="dashboard-workspace__list-link" href={getDatabaseRunHref(run.id)}>
                                {run.name}
                              </Link>
                              <small>{run.query}</small>
                            </div>
                            <span className={`dashboard-workspace__status dashboard-workspace__status--${run.status}`}>
                              {formatRunStatusLabel(run.status)}
                            </span>
                            <p className="dashboard-workspace__run-meta">
                              {formatRunResultCount(run.resultCount)} · Updated {formatRunTimestamp(run.updatedAt)}
                            </p>
                            <p className="dashboard-workspace__run-meta">
                              {getRunStatusSummary({
                                status: run.status,
                                resultCount: run.resultCount,
                                lastError: run.lastError,
                              })}
                            </p>
                          </div>
                        </td>
                        <td>
                          <div className="dashboard-workspace__planned-cell">
                            <strong>Planned</strong>
                            <span>Coverage needs stored target numbers to calculate.</span>
                          </div>
                        </td>
                        <td>
                          <div className="dashboard-workspace__row-actions">
                            <button
                              className="workspace-button workspace-button--small"
                              disabled={isBusy}
                              onClick={() => {
                                void handleBatchAction(run.id, "csv");
                              }}
                              type="button"
                            >
                              Export
                            </button>
                            <button
                              className="workspace-button workspace-button--small workspace-button--secondary"
                              disabled={isBusy}
                              onClick={() => {
                                void handleBatchAction(run.id, "hubspot");
                              }}
                              type="button"
                            >
                              HubSpot
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="dashboard-workspace__empty-state">
              <h3>No scouting runs yet</h3>
              <p>Create the first run from New scouting to populate the dashboard.</p>
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}
