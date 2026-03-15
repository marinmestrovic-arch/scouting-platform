"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React from "react";

import {
  buildDatabaseWorkspaceHref,
  resolveDatabaseTab,
  type DatabaseTab,
} from "../../lib/database-workspace";
import { CatalogTableShell } from "../catalog/catalog-table-shell";
import { DatabaseRunsTab } from "./database-runs-tab";

type DatabaseWorkspaceProps = Readonly<{
  forcedTab?: DatabaseTab;
  showLegacyNotice?: boolean;
}>;

export function DatabaseWorkspace({
  forcedTab,
  showLegacyNotice = false,
}: DatabaseWorkspaceProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRunId = searchParams.get("runId");
  const activeTab = forcedTab ?? resolveDatabaseTab(searchParams);

  function navigate(next: Readonly<{ tab: DatabaseTab; runId?: string | null }>) {
    router.push(buildDatabaseWorkspaceHref(pathname, searchParams, next));
  }

  return (
    <div className="database-workspace">
      <section className="database-workspace__hero">
        <div>
          <p className="workspace-eyebrow">Database</p>
          <h2>Creator database</h2>
          <p className="workspace-copy">
            Review run snapshots and the canonical creator catalog in one workspace, then export or
            hand off the resulting shortlist to HubSpot from the same surface.
          </p>
        </div>

        <div className="database-workspace__hero-card">
          <p className="workspace-eyebrow">Available today</p>
          <ul>
            <li>Run-level CSV export and HubSpot push actions</li>
            <li>Catalog filters, selection, export, and enrichment flows</li>
            <li>Deep links to legacy creator and batch result pages</li>
          </ul>
        </div>
      </section>

      {showLegacyNotice ? (
        <section className="workspace-callout">
          <h3>Legacy route</h3>
          <p>
            This page remains available as a compatibility shortcut. The primary database workspace
            lives at <code>/database</code>.
          </p>
        </section>
      ) : null}

      <section className="database-workspace__tabs" aria-label="Database sections">
        <button
          className={
            activeTab === "catalog"
              ? "database-workspace__tab database-workspace__tab--active"
              : "database-workspace__tab"
          }
          onClick={() => {
            navigate({ tab: "catalog" });
          }}
          type="button"
        >
          Catalog
        </button>
        <button
          className={
            activeTab === "runs"
              ? "database-workspace__tab database-workspace__tab--active"
              : "database-workspace__tab"
          }
          onClick={() => {
            navigate({ tab: "runs", runId: requestedRunId });
          }}
          type="button"
        >
          Runs
        </button>
      </section>

      {activeTab === "catalog" ? (
        <section className="database-workspace__panel">
          <header className="database-workspace__panel-header">
            <div>
              <p className="workspace-eyebrow">Canonical catalog</p>
              <h2>Catalog view</h2>
              <p className="workspace-copy">
                Use the existing creator filters, selection model, enrichment actions, CSV export,
                and HubSpot push flow from the shared catalog.
              </p>
            </div>
          </header>
          <CatalogTableShell />
        </section>
      ) : (
        <DatabaseRunsTab
          onSelectRun={(runId) => {
            navigate({ tab: "runs", runId });
          }}
          requestedRunId={requestedRunId}
        />
      )}
    </div>
  );
}
