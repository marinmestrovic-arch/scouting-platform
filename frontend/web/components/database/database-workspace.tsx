"use client";

import type { ListChannelsResponse, SegmentResponse } from "@scouting-platform/contracts";
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
  initialCatalogData?: ListChannelsResponse;
  initialSavedSegments?: SegmentResponse[];
}>;

export function DatabaseWorkspace({
  forcedTab,
  showLegacyNotice = false,
  initialCatalogData,
  initialSavedSegments,
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
      {showLegacyNotice ? (
        <section className="workspace-callout">
          <h3>Legacy route</h3>
          <p>
            This page remains available as a compatibility shortcut. The primary database workspace
            lives at <code>/database</code>.
          </p>
        </section>
      ) : null}

      {forcedTab ? null : (
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
      )}

      {activeTab === "catalog" ? (
        <section className="database-workspace__panel">
          <CatalogTableShell
            {...(initialCatalogData ? { initialData: initialCatalogData } : {})}
            {...(initialSavedSegments ? { initialSavedSegments } : {})}
          />
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
