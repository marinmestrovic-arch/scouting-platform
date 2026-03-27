"use client";

import type { ListRecentRunsResponse, ListRunsQuery } from "@scouting-platform/contracts";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import { getCsvPreviewHref, getHubspotPreviewHref } from "../../lib/navigation";
import {
  formatCampaignManagerLabel,
  formatNullableMetadataValue,
  formatRunCoverageCopy,
  getRunCoveragePercent,
} from "../../lib/run-metadata";
import { fetchRecentRuns } from "../../lib/runs-api";
import { RUN_STATUS_POLL_INTERVAL_MS, shouldPollRunStatus } from "../runs/run-presentation";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";

type DashboardRunsRequestState =
  | { status: "loading"; data: null; error: null }
  | { status: "error"; data: null; error: string }
  | { status: "ready"; data: ListRecentRunsResponse; error: null };

type DashboardFiltersState = {
  campaignManagerUserId: string;
  client: string;
  market: string;
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

function getDashboardRunsErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to load dashboard runs.";
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

export function DashboardWorkspace({
  initialData,
}: Readonly<{
  initialData?: ListRecentRunsResponse | undefined;
}>) {
  const [requestState, setRequestState] = useState<DashboardRunsRequestState>(
    initialData
      ? {
          status: "ready",
          data: initialData,
          error: null,
        }
      : INITIAL_REQUEST_STATE,
  );
  const [filters, setFilters] = useState<DashboardFiltersState>(INITIAL_FILTERS_STATE);

  useEffect(() => {
    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function loadRuns(polling = false) {
      if (!polling && !initialData) {
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
  }, [filters, initialData]);

  const filterOptions = requestState.status === "ready" ? requestState.data.filterOptions : null;
  const campaignManagerOptions: SearchableSelectOption[] = [
    { value: "", label: "All campaign managers" },
    ...(filterOptions?.campaignManagers.map((campaignManager) => ({
      value: campaignManager.id,
      label: formatCampaignManagerLabel(campaignManager),
      keywords: [campaignManager.email],
    })) ?? []),
  ];
  const clientOptions: SearchableSelectOption[] = [
    { value: "", label: "All clients" },
    ...(filterOptions?.clients.map((client) => ({
      value: client,
      label: client,
    })) ?? []),
  ];
  const marketOptions: SearchableSelectOption[] = [
    { value: "", label: "All markets" },
    ...(filterOptions?.markets.map((market) => ({
      value: market,
      label: market,
    })) ?? []),
  ];

  return (
    <div className="dashboard-workspace">
      <section className="dashboard-workspace__table-panel">
        <div className="dashboard-workspace__filters">
          <label className="new-scouting__field">
            <span>Campaign Manager</span>
            <SearchableSelect
              ariaLabel="Campaign Manager"
              disabled={requestState.status === "loading" || !filterOptions}
              onChange={(campaignManagerUserId) => {
                setFilters((current) => ({
                  ...current,
                  campaignManagerUserId,
                }));
              }}
              options={campaignManagerOptions}
              placeholder="All campaign managers"
              searchPlaceholder="Search campaign managers..."
              value={filters.campaignManagerUserId}
            />
          </label>

          <label className="new-scouting__field">
            <span>Client</span>
            <SearchableSelect
              ariaLabel="Client"
              disabled={requestState.status === "loading" || !filterOptions}
              onChange={(client) => {
                setFilters((current) => ({
                  ...current,
                  client,
                }));
              }}
              options={clientOptions}
              placeholder="All clients"
              searchPlaceholder="Search clients..."
              value={filters.client}
            />
          </label>

          <label className="new-scouting__field">
            <span>Market</span>
            <SearchableSelect
              ariaLabel="Market"
              disabled={requestState.status === "loading" || !filterOptions}
              onChange={(market) => {
                setFilters((current) => ({
                  ...current,
                  market,
                }));
              }}
              options={marketOptions}
              placeholder="All markets"
              searchPlaceholder="Search markets..."
              value={filters.market}
            />
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
                          <Link className="dashboard-workspace__list-link" href={`/runs/${encodeURIComponent(run.id)}`}>
                            {run.name}
                          </Link>
                        </td>
                        <td>{renderCoverageCell(run.resultCount, run.target)}</td>
                        <td>
                          <div className="dashboard-workspace__row-actions">
                            <Link
                              className="workspace-button workspace-button--small"
                              href={getCsvPreviewHref(run.id)}
                              target="_blank"
                            >
                              Export
                            </Link>
                            <Link
                              className="workspace-button workspace-button--small workspace-button--secondary"
                              href={getHubspotPreviewHref(run.id)}
                              target="_blank"
                            >
                              HubSpot
                            </Link>
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
