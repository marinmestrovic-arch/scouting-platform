"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React from "react";

import { AdminAdvancedReportQueue } from "./admin-advanced-report-queue";
import { AdminCsvImportManager } from "./admin-csv-import-manager";
import { AdminUsersManager } from "./admin-users-manager";

type AdminWorkspaceTab = "approvals" | "imports" | "users" | "exports" | "hubspot";

const ADMIN_TABS: ReadonlyArray<{
  value: AdminWorkspaceTab;
  label: string;
}> = [
  { value: "approvals", label: "Approvals" },
  { value: "imports", label: "CSV Imports" },
  { value: "users", label: "Users" },
  { value: "exports", label: "Exports" },
  { value: "hubspot", label: "HubSpot" },
];

function resolveAdminTab(value: string | null): AdminWorkspaceTab {
  switch (value) {
    case "imports":
    case "users":
    case "exports":
    case "hubspot":
      return value;
    default:
      return "approvals";
  }
}

export function AdminWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = resolveAdminTab(searchParams.get("tab"));
  const [refreshKey, setRefreshKey] = React.useState(0);

  function selectTab(tab: AdminWorkspaceTab) {
    const params = new URLSearchParams(searchParams.toString());

    if (tab === "approvals") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }

    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  return (
    <div className="admin-workspace">
      <div className="admin-workspace__toolbar">
        <div className="admin-workspace__tabs" aria-label="Admin sections">
          {ADMIN_TABS.map((tab) => (
            <button
              className={
                activeTab === tab.value
                  ? "admin-workspace__tab admin-workspace__tab--active"
                  : "admin-workspace__tab"
              }
              key={tab.value}
              onClick={() => {
                selectTab(tab.value);
              }}
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

      {activeTab === "approvals" ? (
        <div className="admin-workspace__panel" key={`approvals-${refreshKey}`}>
          <div id="admin-approval-queue">
            <AdminAdvancedReportQueue />
          </div>
        </div>
      ) : null}

      {activeTab === "imports" ? (
        <div className="admin-workspace__panel" key={`imports-${refreshKey}`}>
          <AdminCsvImportManager />
        </div>
      ) : null}

      {activeTab === "users" ? (
        <div className="admin-workspace__panel" key={`users-${refreshKey}`}>
          <AdminUsersManager />
        </div>
      ) : null}

      {activeTab === "exports" ? (
        <section className="admin-workspace__panel admin-workspace__panel--placeholder" key={`exports-${refreshKey}`}>
          <div className="admin-workspace__placeholder">
            <h2>Exports</h2>
            <p>Review selected and filtered export batches from the dedicated export workspace.</p>
            <Link className="admin-workspace__link" href="/exports">
              Open exports workspace
            </Link>
          </div>
        </section>
      ) : null}

      {activeTab === "hubspot" ? (
        <section className="admin-workspace__panel admin-workspace__panel--placeholder" key={`hubspot-${refreshKey}`}>
          <div className="admin-workspace__placeholder">
            <h2>HubSpot</h2>
            <p>Inspect import history, row-level results, and failure details in the dedicated HubSpot workspace.</p>
            <Link className="admin-workspace__link" href="/hubspot">
              Open HubSpot workspace
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
