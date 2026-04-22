"use client";

import type { ListRecentRunsResponse, ListRunsQuery } from "@scouting-platform/contracts";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import { useDocumentVisibility } from "../../lib/document-visibility";
import { getCsvPreviewHref, getHubspotPreviewHref } from "../../lib/navigation";
import {
  formatCampaignManagerLabel,
  formatNullableMetadataValue,
  formatRunCoverageCopy,
  getRunCoveragePercent,
} from "../../lib/run-metadata";
import { fetchRecentRuns } from "../../lib/runs-api";
import {
  formatRunTimestamp,
  RUN_STATUS_POLL_INTERVAL_MS,
  shouldPollRunStatus,
} from "../runs/run-presentation";
import { PageHeader } from "../layout/PageHeader";
import { DataTable } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";
import { StatusPill } from "../ui/StatusPill";

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

const DASHBOARD_DESCRIPTION =
  "Review recent scouting runs, track coverage against each run target, and hand each run off to Database, CSV export, or Google Sheets from one compact table.";

type DashboardStatusFilter = "all" | "running" | "completed" | "failed";

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

function parseStatusFilter(value: string | null): DashboardStatusFilter {
  if (value === "running" || value === "completed" || value === "failed") {
    return value;
  }

  return "all";
}

function matchesStatusFilter(
  run: ListRecentRunsResponse["items"][number],
  statusFilter: DashboardStatusFilter,
): boolean {
  if (statusFilter === "all") {
    return true;
  }

  if (statusFilter === "running") {
    return run.status === "queued" || run.status === "running";
  }

  return run.status === statusFilter;
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
  initialFilters = INITIAL_FILTERS_STATE,
}: Readonly<{
  initialData?: ListRecentRunsResponse | undefined;
  initialFilters?: DashboardFiltersState;
}>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [requestState, setRequestState] = useState<DashboardRunsRequestState>(
    initialData
      ? {
          status: "ready",
          data: initialData,
          error: null,
        }
      : INITIAL_REQUEST_STATE,
  );
  const [filters, setFilters] = useState<DashboardFiltersState>(initialFilters);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const isDocumentVisible = useDocumentVisibility();
  const statusFilter = parseStatusFilter(searchParams.get("status"));

  useEffect(() => {
    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const hasDefaultFilters =
      filters.campaignManagerUserId.length === 0 && filters.client.length === 0 && filters.market.length === 0;
    const canReuseInitialData = reloadToken === 0 && hasDefaultFilters && initialData;

    async function loadRuns(polling = false) {
      if (!polling && !canReuseInitialData) {
        setRequestState(INITIAL_REQUEST_STATE);
      }

      try {
        const recentRuns =
          canReuseInitialData && !polling ? initialData : await fetchRecentRuns({
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

        if (
          isDocumentVisible &&
          recentRuns.items.some((run) => shouldPollRunStatus(run.status))
        ) {
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
  }, [filters, initialData, isDocumentVisible, reloadToken]);

  const filterOptions = requestState.status === "ready" ? requestState.data.filterOptions : null;
  const campaignManagerOptions: SearchableSelectOption[] = useMemo(
    () => [
      { value: "", label: "All campaign managers" },
      ...(filterOptions?.campaignManagers.map((campaignManager) => ({
        value: campaignManager.id,
        label: formatCampaignManagerLabel(campaignManager),
        keywords: [campaignManager.email],
      })) ?? []),
    ],
    [filterOptions],
  );
  const clientOptions: SearchableSelectOption[] = useMemo(
    () => [
      { value: "", label: "All clients" },
      ...(filterOptions?.clients.map((client) => ({
        value: client,
        label: client,
      })) ?? []),
    ],
    [filterOptions],
  );
  const marketOptions: SearchableSelectOption[] = useMemo(
    () => [
      { value: "", label: "All markets" },
      ...(filterOptions?.markets.map((market) => ({
        value: market,
        label: market,
      })) ?? []),
    ],
    [filterOptions],
  );
  const visibleRuns =
    requestState.status === "ready"
      ? requestState.data.items.filter((run) => {
          const normalizedQuery = query.trim().toLowerCase();
          const matchesQuery =
            normalizedQuery.length === 0 ||
            run.name.toLowerCase().includes(normalizedQuery) ||
            run.metadata.campaignName?.toLowerCase().includes(normalizedQuery) === true;

          return matchesQuery && matchesStatusFilter(run, statusFilter);
        })
      : [];
  const isPolling = visibleRuns.some((run) => shouldPollRunStatus(run.status));
  const hasAnyFiltersApplied =
    query.trim().length > 0 ||
    statusFilter !== "all" ||
    filters.campaignManagerUserId.length > 0 ||
    filters.client.length > 0 ||
    filters.market.length > 0;

  function handleStatusFilterChange(nextStatus: DashboardStatusFilter) {
    const nextSearchParams = new URLSearchParams(searchParams.toString());

    if (nextStatus === "all") {
      nextSearchParams.delete("status");
    } else {
      nextSearchParams.set("status", nextStatus);
    }

    const nextHref = nextSearchParams.toString();
    router.replace(nextHref.length > 0 ? `${pathname}?${nextHref}` : pathname, { scroll: false });
  }

  function clearQuickFilters() {
    setQuery("");
    handleStatusFilterChange("all");
  }

  function clearAllFilters() {
    setFilters(INITIAL_FILTERS_STATE);
    clearQuickFilters();
  }

  return (
    <>
      <PageHeader
        actions={
          <>
            <button
              className="workspace-button workspace-button--secondary workspace-button--small"
              onClick={() => {
                setReloadToken((current) => current + 1);
              }}
              type="button"
            >
              Refresh
            </button>
            <Link className="workspace-button workspace-button--small" href="/new-scouting">
              New run
            </Link>
          </>
        }
        crumbs={[{ label: "Dashboard" }]}
        description={DASHBOARD_DESCRIPTION}
        live={isPolling}
        title="Dashboard"
      />
      <div className="page-container page-section__body">
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
        <div className="dashboard-workspace__row-actions">
          <label className="new-scouting__field" style={{ flex: "1 1 16rem", minWidth: "min(100%, 16rem)" }}>
            <span>Search runs</span>
            <input
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
              placeholder="Search campaign or list"
              type="search"
              value={query}
            />
          </label>
          <button
            aria-pressed={statusFilter === "all"}
            className="status-pill-button"
            onClick={() => {
              handleStatusFilterChange("all");
            }}
            type="button"
          >
            <span className="status-pill status-pill--neutral">All</span>
          </button>
          <button
            aria-pressed={statusFilter === "running"}
            className="status-pill-button"
            onClick={() => {
              handleStatusFilterChange("running");
            }}
            type="button"
          >
            <StatusPill status="running" />
          </button>
          <button
            aria-pressed={statusFilter === "completed"}
            className="status-pill-button"
            onClick={() => {
              handleStatusFilterChange("completed");
            }}
            type="button"
          >
            <StatusPill status="completed" />
          </button>
          <button
            aria-pressed={statusFilter === "failed"}
            className="status-pill-button"
            onClick={() => {
              handleStatusFilterChange("failed");
            }}
            type="button"
          >
            <StatusPill status="failed" />
          </button>
        </div>

        {requestState.status === "loading" ? (
          <div className="dashboard-workspace__feedback" role="status">
            Loading dashboard runs.
          </div>
        ) : null}

        {requestState.status === "error" ? (
          <ErrorState description={requestState.error} onRetry={() => setReloadToken((current) => current + 1)} title="Couldn't load dashboard" />
        ) : null}

        {requestState.status === "ready" ? (
          requestState.data.items.length > 0 ? (
            visibleRuns.length > 0 ? (
            <DataTable caption="Recent scouting runs" density="regular">
                <thead>
                  <tr>
                    <th scope="col" style={{ minWidth: "9rem" }}>Client</th>
                    <th scope="col" style={{ minWidth: "8rem" }}>Market</th>
                    <th scope="col" style={{ minWidth: "10rem" }}>Campaign Manager</th>
                    <th scope="col" style={{ minWidth: "8rem" }}>Brief Link</th>
                    <th scope="col" style={{ minWidth: "12rem" }}>Influencer List</th>
                    <th scope="col" style={{ minWidth: "12rem" }}>Coverage</th>
                    <th scope="col" style={{ minWidth: "8rem" }}>Status</th>
                    <th scope="col" style={{ minWidth: "9rem" }}>Started</th>
                    <th scope="col" style={{ minWidth: "11rem" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRuns.map((run) => {
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
                          <StatusPill status={run.status} />
                        </td>
                        <td>{formatRunTimestamp(run.startedAt)}</td>
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
                              Google Sheets
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
            </DataTable>
          ) : (
            <div className="data-table__scroll">
              <EmptyState
                action={
                  <button className="workspace-button workspace-button--secondary" onClick={clearQuickFilters} type="button">
                    Clear
                  </button>
                }
                description="Clear filters to see all runs."
                title="No runs match"
              />
            </div>
          )
          ) : hasAnyFiltersApplied ? (
            <EmptyState
              action={
                <button className="workspace-button workspace-button--secondary" onClick={clearAllFilters} type="button">
                  Clear filters
                </button>
              }
              description="Adjust or clear filters to see matching runs."
              title="No runs match"
            />
          ) : (
            <EmptyState
              action={
                <Link className="workspace-button" href="/new-scouting">
                  New run
                </Link>
              }
              description="Create the first run from New scouting to populate the dashboard."
              title="No scouting runs yet"
            />
          )
        ) : null}
      </section>
        </div>
      </div>
    </>
  );
}
