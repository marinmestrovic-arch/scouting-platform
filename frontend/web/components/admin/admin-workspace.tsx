"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React from "react";

const AdminCsvImportManager = dynamic(
  () => import("./admin-csv-import-manager").then((mod) => mod.AdminCsvImportManager),
);
const AdminUsersManager = dynamic(
  () => import("./admin-users-manager").then((mod) => mod.AdminUsersManager),
);

type AdminWorkspaceTab = "imports" | "users" | "exports" | "hubspot";

const ADMIN_TABS: ReadonlyArray<{
  value: AdminWorkspaceTab;
  label: string;
}> = [
  { value: "imports", label: "CSV Imports" },
  { value: "users", label: "Users" },
  { value: "exports", label: "Exports" },
  { value: "hubspot", label: "HubSpot" },
];

function resolveAdminTab(value: string | null): AdminWorkspaceTab {
  switch (value) {
    case "users":
    case "imports":
    case "exports":
    case "hubspot":
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

      {activeTab === "hubspot" ? (
        <div
          aria-labelledby="admin-workspace-tab-hubspot"
          className="admin-workspace__panel"
          id={activePanelId}
          key={`hubspot-${refreshKey}`}
          role="tabpanel"
        >
          <h3>HubSpot workspace</h3>
          <p>HubSpot sync operations are available in the dedicated workspace.</p>
          <Link href="/hubspot">Open /hubspot</Link>
        </div>
      ) : null}
    </div>
  );
}
