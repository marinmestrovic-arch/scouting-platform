"use client";

import type {
  AlmediaBookingsResponse,
  AlmediaCampaignsResponse,
  AlmediaDealsResponse,
  AlmediaInvoicesResponse,
  AlmediaScorecardResponse,
} from "@scouting-platform/contracts";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";

import {
  fetchAlmediaBookings,
  fetchAlmediaCampaigns,
  fetchAlmediaDeals,
  fetchAlmediaInvoices,
  fetchAlmediaScorecard,
  requestAlmediaSync,
} from "../../lib/almedia-api";
import {
  ALMEDIA_TAB_LABELS,
  ALMEDIA_TABS_IN_ORDER,
  buildAlmediaWorkspaceHref,
  formatAlmediaSyncFailure,
  resolveAlmediaTab,
} from "../../lib/almedia-workspace";
import { timeAgo } from "../../lib/almedia/format";
import { useDocumentVisibility } from "../../lib/document-visibility";
import { PageHeader } from "../layout/PageHeader";
import { ErrorState } from "../ui/ErrorState";
import { SkeletonPageBody, SkeletonTable } from "../ui/skeleton";
import { AlmediaBookingsTab } from "./almedia-bookings-tab";
import { AlmediaInsightsTab } from "./almedia-insights-tab";
import { AlmediaInvoicesTab } from "./almedia-invoices-tab";
import { AlmediaPerformanceTab } from "./almedia-performance-tab";
import { AlmediaScorecardTab } from "./almedia-scorecard-tab";

/**
 * The Almedia workspace shell: one fetch of the three read models, three tabs
 * over them, and a visibility-gated refresh. The hourly worker sync is what
 * actually pulls from Almedia; this page only reads Postgres, and the Refresh
 * button asks the worker for an out-of-band run.
 */

/** The worker syncs hourly; a 5-minute poll picks a new run up quickly enough. */
export const ALMEDIA_POLL_INTERVAL_MS = 5 * 60 * 1000;

type AlmediaData = Readonly<{
  deals: AlmediaDealsResponse;
  campaigns: AlmediaCampaignsResponse;
  scorecard: AlmediaScorecardResponse;
  bookings: AlmediaBookingsResponse;
  invoices: AlmediaInvoicesResponse;
  fetchedAt: Date;
}>;

type AlmediaRequestState =
  | { status: "loading"; data: null; error: null }
  | { status: "error"; data: null; error: string }
  | { status: "ready"; data: AlmediaData; error: null };

const INITIAL_REQUEST_STATE: AlmediaRequestState = {
  status: "loading",
  data: null,
  error: null,
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function AlmediaWorkspace({
  isAdmin = false,
}: Readonly<{ isAdmin?: boolean }> = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = resolveAlmediaTab(searchParams);

  const [requestState, setRequestState] =
    useState<AlmediaRequestState>(INITIAL_REQUEST_STATE);
  const [reloadToken, setReloadToken] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const isDocumentVisible = useDocumentVisibility();

  useEffect(() => {
    let didCancel = false;
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function load(polling: boolean): Promise<void> {
      if (!polling) {
        setRequestState(INITIAL_REQUEST_STATE);
      }

      try {
        const [deals, campaigns, scorecard, bookings, invoices] = await Promise.all([
          fetchAlmediaDeals(abortController.signal),
          fetchAlmediaCampaigns(abortController.signal),
          fetchAlmediaScorecard(abortController.signal),
          fetchAlmediaBookings(abortController.signal),
          fetchAlmediaInvoices(abortController.signal),
        ]);

        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "ready",
          data: {
            deals,
            campaigns,
            scorecard,
            bookings,
            invoices,
            fetchedAt: new Date(),
          },
          error: null,
        });

        if (isDocumentVisible) {
          timeoutId = setTimeout(() => {
            void load(true);
          }, ALMEDIA_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (didCancel || abortController.signal.aborted) {
          return;
        }

        setRequestState({
          status: "error",
          data: null,
          error: getErrorMessage(error, "Unable to load Almedia tracking data."),
        });
      }
    }

    void load(false);

    return () => {
      didCancel = true;
      abortController.abort();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isDocumentVisible, reloadToken]);

  // A booking write changes the deal join and the scorecard; an invoice write
  // changes what the billing view considers outstanding. Either way the whole
  // workspace reloads rather than just the tab that was edited.
  const handleWorkspaceMutated = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    setSyncError(null);

    void requestAlmediaSync()
      .then(() => {
        setSyncError(null);
      })
      .catch((error: unknown) => {
        setSyncError(getErrorMessage(error, "Unable to queue an Almedia sync."));
      })
      .finally(() => {
        setIsRefreshing(false);
        // Reload regardless: the queued sync lands asynchronously, but the read
        // models may already have moved on since the page was opened.
        setReloadToken((token) => token + 1);
      });
  }, []);

  const data = requestState.status === "ready" ? requestState.data : null;
  const sync = data?.deals.sync ?? null;

  return (
    <>
      <PageHeader
        actions={
          <div className="almedia-header-actions">
            <p className="almedia-header-actions__status">
              {requestState.status === "loading"
                ? "Loading…"
                : `Updated ${timeAgo(data?.fetchedAt ?? null)}`}
              {data ? ` · ${data.deals.deals.length} deals` : ""}
            </p>
            {isAdmin ? (
              <button
                className="workspace-button"
                disabled={isRefreshing || requestState.status === "loading"}
                onClick={handleRefresh}
                type="button"
              >
                {isRefreshing ? "Syncing…" : "Refresh"}
              </button>
            ) : null}
          </div>
        }
        crumbs={[{ label: "Almedia" }]}
        description="Live Freecash campaign performance joined with the internal booking tracker."
        live={isRefreshing}
        title="Almedia"
      />

      <div className="page-container page-section__body">
        <nav aria-label="Almedia views" className="almedia-tabs">
          {ALMEDIA_TABS_IN_ORDER.map((tab) => (
            <Link
              aria-current={tab === activeTab ? "page" : undefined}
              className={
                tab === activeTab ? "almedia-tab almedia-tab--active" : "almedia-tab"
              }
              href={buildAlmediaWorkspaceHref(pathname, searchParams, { tab })}
              key={tab}
              scroll={false}
            >
              {ALMEDIA_TAB_LABELS[tab]}
            </Link>
          ))}
        </nav>

        {sync?.lastError ? (
          <p className="almedia-sync-warning" role="status">
            {formatAlmediaSyncFailure(sync.lastError)}
          </p>
        ) : null}

        {syncError ? (
          <p className="almedia-sync-warning" role="alert">
            {syncError}
          </p>
        ) : null}

        {requestState.status === "loading" ? (
          <SkeletonPageBody>
            <SkeletonTable columns={6} rows={6} />
          </SkeletonPageBody>
        ) : null}

        {requestState.status === "error" ? (
          <ErrorState
            description={requestState.error}
            onRetry={() => {
              setReloadToken((token) => token + 1);
            }}
            title="Almedia tracking is unavailable"
          />
        ) : null}

        {data ? (
          <>
            {activeTab === "insights" ? (
              <AlmediaInsightsTab
                deals={data.deals.deals}
                isAdmin={isAdmin}
                onMutated={handleWorkspaceMutated}
                options={data.deals.options}
                scorecard={data.scorecard}
              />
            ) : null}
            {activeTab === "bookings" ? (
              <AlmediaBookingsTab
                bookings={data.bookings.bookings}
                deals={data.deals.deals}
                isAdmin={isAdmin}
                onMutated={handleWorkspaceMutated}
              />
            ) : null}
            {activeTab === "performance" ? (
              <AlmediaPerformanceTab
                campaigns={data.campaigns.campaigns}
                deals={data.deals.deals}
              />
            ) : null}
            {activeTab === "scorecard" ? (
              <AlmediaScorecardTab scorecard={data.scorecard} />
            ) : null}
            {activeTab === "invoices" ? (
              <AlmediaInvoicesTab
                deals={data.deals.deals}
                isAdmin={isAdmin}
                invoices={data.invoices.invoices}
                onMutated={handleWorkspaceMutated}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
