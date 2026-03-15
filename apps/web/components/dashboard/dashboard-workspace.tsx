"use client";

import type { ListRecentRunsResponse } from "@scouting-platform/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { getDatabaseRunHref } from "../../lib/database-workspace";
import { getCsvExportBatchResultHref, getHubspotPushBatchResultHref } from "../../lib/navigation";
import {
  createCsvExportBatchFromRun,
  createHubspotPushBatchFromRun,
  RunBatchActionError,
} from "../../lib/run-batch-actions";
import { fetchRecentRuns } from "../../lib/runs-api";
import {
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

function formatRunTarget(target: number | null): string {
  if (target === null) {
    return "—";
  }

  return String(target);
}

function formatRunCoverage(resultCount: number, target: number | null): string {
  if (target === null) {
    return `${resultCount} / —`;
  }

  return `${resultCount} / ${target}`;
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
      {actionState.status === "error" ? (
        <section className="workspace-callout workspace-callout--error" role="alert">
          <h3>Run action failed</h3>
          <p>{actionState.message}</p>
        </section>
      ) : null}

      <section className="dashboard-workspace__table-panel">
        <header className="dashboard-workspace__table-header">
          <div>
            <h2>Runs</h2>
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
                          <span className="dashboard-workspace__planned-cell">Pending backend</span>
                        </td>
                        <td>
                          <span className="dashboard-workspace__planned-cell">Pending backend</span>
                        </td>
                        <td>
                          <span>{formatRunTarget(run.target)}</span>
                        </td>
                        <td>
                          <Link className="dashboard-workspace__list-link" href={getDatabaseRunHref(run.id)}>
                            {run.name}
                          </Link>
                        </td>
                        <td>
                          <span>{formatRunCoverage(run.resultCount, run.target)}</span>
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
