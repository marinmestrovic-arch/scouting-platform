"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";

import { fetchAdminDashboard } from "../../lib/admin-dashboard-api";

const AdminCsvImportManager = dynamic(
  () => import("./admin-csv-import-manager").then((mod) => mod.AdminCsvImportManager),
);
const AdminUsersManager = dynamic(
  () => import("./admin-users-manager").then((mod) => mod.AdminUsersManager),
);

type AdminWorkspaceTab = "imports" | "users" | "exports";

const ADMIN_TABS: ReadonlyArray<{
  value: AdminWorkspaceTab;
  label: string;
}> = [
  { value: "imports", label: "CSV Imports" },
  { value: "users", label: "Users" },
  { value: "exports", label: "Exports" },
];

type EnrichmentBannerState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; enrichedCount: number; notEnrichedCount: number; totalCount: number };

function getEnrichmentPercent(enrichedCount: number, totalCount: number): number {
  if (totalCount === 0) {
    return 0;
  }

  return Math.round((enrichedCount / totalCount) * 100);
}

function EnrichmentBanner({ refreshKey }: { refreshKey: number }): React.ReactElement {
  const [state, setState] = useState<EnrichmentBannerState>({ status: "loading" });

  useEffect(() => {
    const abortController = new AbortController();

    setState({ status: "loading" });

    void (async () => {
      try {
        const dashboard = await fetchAdminDashboard(abortController.signal);

        if (abortController.signal.aborted) {
          return;
        }

        setState({
          status: "ready",
          enrichedCount: dashboard.enrichment.enrichedCount,
          notEnrichedCount: dashboard.enrichment.notEnrichedCount,
          totalCount: dashboard.enrichment.totalCount,
        });
      } catch {
        if (!abortController.signal.aborted) {
          setState({ status: "error" });
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [refreshKey]);

  if (state.status === "loading") {
    return (
      <div className="admin-workspace__enrichment-banner admin-workspace__enrichment-banner--loading" aria-busy="true">
        <span className="admin-workspace__enrichment-label">Channel enrichment</span>
        <span className="admin-workspace__enrichment-loading">Loading…</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="admin-workspace__enrichment-banner admin-workspace__enrichment-banner--error">
        <span className="admin-workspace__enrichment-label">Channel enrichment</span>
        <span className="admin-workspace__enrichment-error">Could not load enrichment data.</span>
      </div>
    );
  }

  const { enrichedCount, notEnrichedCount, totalCount } = state;
  const percent = getEnrichmentPercent(enrichedCount, totalCount);

  return (
    <div className="admin-workspace__enrichment-banner">
      <span className="admin-workspace__enrichment-label">Channel enrichment</span>
      <span className="admin-workspace__enrichment-counts">
        <span className="admin-workspace__enrichment-enriched">{enrichedCount} enriched</span>
        {" · "}
        <span className="admin-workspace__enrichment-not">{notEnrichedCount} not enriched</span>
        {" · "}
        <span className="admin-workspace__enrichment-total">{enrichedCount}/{totalCount} ({percent}%)</span>
      </span>
      <div
        className="admin-workspace__enrichment-bar"
        aria-label={`${percent}% enriched`}
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="admin-workspace__enrichment-bar-fill"
          style={{ width: `${percent}%` }}
        />
      </div>
      {notEnrichedCount > 0 ? (
        <Link
          className="admin-workspace__enrichment-link"
          href="/catalog?enrichmentStatus=not_enriched"
        >
          View not enriched →
        </Link>
      ) : null}
    </div>
  );
}

function resolveAdminTab(value: string | null): AdminWorkspaceTab {
  switch (value) {
    case "users":
    case "imports":
    case "exports":
      return value;
    default:
      return "imports";
  }
}

export function AdminWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = resolveAdminTab(searchParams.get("tab"));
  const [refreshKey, setRefreshKey] = React.useState(0);
  const activePanelId = `admin-workspace-panel-${activeTab}`;

  function selectTab(tab: AdminWorkspaceTab) {
    const params = new URLSearchParams(searchParams.toString());

    if (tab === "imports") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }

    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  return (
    <div className="admin-workspace">
      <EnrichmentBanner refreshKey={refreshKey} />

      <div className="admin-workspace__toolbar">
        <div
          aria-label="Admin sections"
          className="admin-workspace__tabs"
          role="tablist"
        >
          {ADMIN_TABS.map((tab) => (
            <button
              aria-controls={`admin-workspace-panel-${tab.value}`}
              aria-selected={activeTab === tab.value}
              className={
                activeTab === tab.value
                  ? "admin-workspace__tab admin-workspace__tab--active"
                  : "admin-workspace__tab"
              }
              id={`admin-workspace-tab-${tab.value}`}
              key={tab.value}
              onClick={() => {
                selectTab(tab.value);
              }}
              role="tab"
              tabIndex={activeTab === tab.value ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          className="admin-workspace__refresh"
          onClick={() => {
            setRefreshKey((current) => current + 1);
          }}
          type="button"
        >
          Refresh
        </button>
      </div>

      {activeTab === "imports" ? (
        <div
          aria-labelledby="admin-workspace-tab-imports"
          className="admin-workspace__panel"
          id={activePanelId}
          key={`imports-${refreshKey}`}
          role="tabpanel"
        >
          <AdminCsvImportManager />
        </div>
      ) : null}

      {activeTab === "users" ? (
        <div
          aria-labelledby="admin-workspace-tab-users"
          className="admin-workspace__panel"
          id={activePanelId}
          key={`users-${refreshKey}`}
          role="tabpanel"
        >
          <AdminUsersManager />
        </div>
      ) : null}

      {activeTab === "exports" ? (
        <div
          aria-labelledby="admin-workspace-tab-exports"
          className="admin-workspace__panel"
          id={activePanelId}
          key={`exports-${refreshKey}`}
          role="tabpanel"
        >
          <h3>Exports workspace</h3>
          <p>Export operations are available in the dedicated workspace.</p>
          <Link href="/exports">Open /exports</Link>
        </div>
      ) : null}

    </div>
  );
}
