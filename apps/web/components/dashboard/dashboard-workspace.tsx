"use client";

import type { ListRecentRunsResponse, ListRunsQuery } from "@scouting-platform/contracts";
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
import {
  formatCampaignManagerLabel,
  formatNullableMetadataValue,
  formatRunCoverageCopy,
  getRunCoveragePercent,
} from "../../lib/run-metadata";
import { fetchRecentRuns } from "../../lib/runs-api";
import { RUN_STATUS_POLL_INTERVAL_MS, shouldPollRunStatus } from "../runs/run-presentation";

type DashboardRunsRequestState =
  | { status: "loading"; data: null; error: null }
  | { status: "error"; data: null; error: string }
  | { status: "ready"; data: ListRecentRunsResponse; error: null };

type DashboardFiltersState = {
  campaignManagerUserId: string;
  client: string;
  market: string;
};

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

const INITIAL_FILTERS_STATE: DashboardFiltersState = {
  campaignManagerUserId: "",
  client: "",
  market: "",
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

  return "Unable to load dashboard runs.";
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
    : "Unable to create the HubSpot import batch for this run.";
}

function buildRunFilters(filters: DashboardFiltersState): Partial<ListRunsQuery> {
  return {
    campaignManagerUserId: filters.campaignManagerUserId || undefined,
    client: filters.client || undefined,
    market: filters.market || undefined,
    limit: 50,
  };
}

function renderCoverageCell(resultCount: number, target: number | null) {
  const percent = getRunCoveragePercent(resultCount, target) ?? 0;

  return (
    <div className="dashboard-workspace__coverage">
      <div
        aria-hidden="true"
        className="dashboard-workspace__coverage-bar"
      >
        <span
          className="dashboard-workspace__coverage-progress"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="dashboard-workspace__coverage-copy">{formatRunCoverageCopy(resultCount, target)}</p>
    </div>
  );
}

export function DashboardWorkspace() {
  const router = useRouter();
  const [requestState, setRequestState] = useState<DashboardRunsRequestState>(INITIAL_REQUEST_STATE);
  const [filters, setFilters] = useState<DashboardFiltersState>(INITIAL_FILTERS_STATE);
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
        const recentRuns = await fetchRecentRuns({
          signal: abortController.signal,
          filters: buildRunFilters(filters),
        });

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
  }, [filters, reloadToken]);

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

  const filterOptions = requestState.status === "ready" ? requestState.data.filterOptions : null;

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
            <p className="workspace-copy">
              Filter the scouting list by campaign manager, client, or market, then export the
              run or generate a HubSpot import batch from the same saved snapshot.
            </p>
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

        <div className="dashboard-workspace__filters">
          <label className="new-scouting__field">
            <span>Campaign Manager</span>
            <select
              disabled={requestState.status === "loading" || !filterOptions}
              onChange={(event) => {
                setFilters((current) => ({
                  ...current,
                  campaignManagerUserId: event.currentTarget.value,
                }));
              }}
              value={filters.campaignManagerUserId}
            >
              <option value="">All campaign managers</option>
              {filterOptions?.campaignManagers.map((campaignManager) => (
                <option key={campaignManager.id} value={campaignManager.id}>
                  {formatCampaignManagerLabel(campaignManager)}
                </option>
              ))}
            </select>
          </label>

          <label className="new-scouting__field">
            <span>Client</span>
            <select
              disabled={requestState.status === "loading" || !filterOptions}
              onChange={(event) => {
                setFilters((current) => ({
                  ...current,
                  client: event.currentTarget.value,
                }));
              }}
              value={filters.client}
            >
              <option value="">All clients</option>
              {filterOptions?.clients.map((client) => (
                <option key={client} value={client}>
                  {client}
                </option>
              ))}
            </select>
          </label>

          <label className="new-scouting__field">
            <span>Market</span>
            <select
              disabled={requestState.status === "loading" || !filterOptions}
              onChange={(event) => {
                setFilters((current) => ({
                  ...current,
                  market: event.currentTarget.value,
                }));
              }}
              value={filters.market}
            >
              <option value="">All markets</option>
              {filterOptions?.markets.map((market) => (
                <option key={market} value={market}>
                  {market}
                </option>
              ))}
            </select>
          </label>
        </div>

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
                    <th>Client</th>
                    <th>Market</th>
                    <th>Campaign Manager</th>
                    <th>Brief Link</th>
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
                        <td>{formatNullableMetadataValue(run.metadata.client)}</td>
                        <td>{formatNullableMetadataValue(run.metadata.market)}</td>
                        <td>{formatCampaignManagerLabel(run.metadata.campaignManager)}</td>
                        <td>
                          {run.metadata.briefLink ? (
                            <a
                              className="dashboard-workspace__list-link"
                              href={run.metadata.briefLink}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open brief
                            </a>
                          ) : (
                            <span className="dashboard-workspace__planned-cell">—</span>
                          )}
                        </td>
                        <td>
                          <Link className="dashboard-workspace__list-link" href={getDatabaseRunHref(run.id)}>
                            {run.name}
                          </Link>
                          <p className="dashboard-workspace__planned-cell">{run.query}</p>
                        </td>
                        <td>{renderCoverageCell(run.resultCount, run.target)}</td>
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
