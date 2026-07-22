"use client";

import type {
  DropdownValue,
  ListCampaignsResponse,
  ListClientsResponse,
  ListHubspotObjectSyncRunsResponse,
} from "@scouting-platform/contracts";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import {
  createHubspotObjectSyncRunRequest,
  fetchHubspotObjectSyncRuns,
} from "../../lib/hubspot-object-sync-api";

const CampaignsWorkspace = dynamic(
  () => import("../campaigns/campaigns-workspace").then((mod) => mod.CampaignsWorkspace),
);
const ClientsWorkspace = dynamic(
  () => import("../database/clients-workspace").then((mod) => mod.ClientsWorkspace),
);
const DropdownValuesWorkspace = dynamic(
  () => import("./dropdown-values-workspace").then((mod) => mod.DropdownValuesWorkspace),
);
const HubspotIntegrationWorkspace = dynamic(
  () => import("./hubspot-integration-workspace").then((mod) => mod.HubspotIntegrationWorkspace),
);

function formatHubspotSyncStatus(
  run: ListHubspotObjectSyncRunsResponse["latest"],
): string | null {
  if (!run) {
    return null;
  }

  if (run.status === "completed") {
    return run.lastError
      ? `HubSpot sync completed with warnings: ${run.lastError}`
      : "HubSpot sync completed.";
  }

  if (run.status === "failed") {
    return run.lastError ? `HubSpot sync failed: ${run.lastError}` : "HubSpot sync failed.";
  }

  return null;
}

export function DatabaseAdminWorkspace({
  campaigns,
  clients,
  dropdownValues,
  hubspotSyncRuns,
  isAdmin,
}: Readonly<{
  campaigns: ListCampaignsResponse;
  clients: ListClientsResponse;
  dropdownValues: DropdownValue[];
  hubspotSyncRuns: ListHubspotObjectSyncRunsResponse;
  isAdmin: boolean;
}>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [syncRuns, setSyncRuns] = useState(hubspotSyncRuns);
  const [syncStatus, setSyncStatus] = useState("");
  const [isTriggeringSync, setIsTriggeringSync] = useState(false);
  const requestedTab = searchParams.get("tab");
  const activeTab =
    requestedTab === "campaigns"
      ? "campaigns"
      : requestedTab === "dropdown-values" && isAdmin
        ? "dropdown-values"
        : requestedTab === "hubspot" && isAdmin
          ? "hubspot"
          : "clients";

  function selectTab(tab: "clients" | "campaigns" | "dropdown-values" | "hubspot") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/database?${params.toString()}`);
  }

  const latestSyncRun = syncRuns.latest;
  const isSyncRunning =
    latestSyncRun?.status === "queued" || latestSyncRun?.status === "running" || isTriggeringSync;

  useEffect(() => {
    setSyncRuns(hubspotSyncRuns);
  }, [hubspotSyncRuns]);

  useEffect(() => {
    if (
      !isAdmin ||
      (latestSyncRun?.status !== "queued" && latestSyncRun?.status !== "running")
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      void fetchHubspotObjectSyncRuns()
        .then((runs) => {
          setSyncRuns(runs);

          const syncStatusMessage = formatHubspotSyncStatus(runs.latest);

          if (syncStatusMessage) {
            setSyncStatus(syncStatusMessage);
            router.refresh();
          }
        })
        .catch((error) => {
          setSyncStatus(error instanceof Error ? error.message : "Unable to refresh HubSpot sync status.");
        });
    }, 3000);

    return () => window.clearInterval(interval);
  }, [isAdmin, latestSyncRun?.status, router]);

  async function handleHubspotObjectSync() {
    setIsTriggeringSync(true);
    setSyncStatus("");

    try {
      const run = await createHubspotObjectSyncRunRequest();
      setSyncRuns((current) => ({
        items: [run, ...current.items.filter((item) => item.id !== run.id)],
        latest: run,
      }));
      setSyncStatus("HubSpot sync queued.");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Unable to sync HubSpot objects.");
    } finally {
      setIsTriggeringSync(false);
    }
  }

  return (
    <div className="database-admin">
      <div className="database-admin__topbar">
        <section className="database-admin__tabs" aria-label="Database sections">
          <button
            className={activeTab === "clients" ? "database-admin__tab database-admin__tab--active" : "database-admin__tab"}
            onClick={() => selectTab("clients")}
            type="button"
          >
            Clients
          </button>
          <button
            className={activeTab === "campaigns" ? "database-admin__tab database-admin__tab--active" : "database-admin__tab"}
            onClick={() => selectTab("campaigns")}
            type="button"
          >
            Campaigns
          </button>
          {isAdmin ? (
            <>
              <button
                className={activeTab === "dropdown-values" ? "database-admin__tab database-admin__tab--active" : "database-admin__tab"}
                onClick={() => selectTab("dropdown-values")}
                type="button"
              >
                Dropdown Values
              </button>
              <button
                className={activeTab === "hubspot" ? "database-admin__tab database-admin__tab--active" : "database-admin__tab"}
                onClick={() => selectTab("hubspot")}
                type="button"
              >
                HubSpot
              </button>
            </>
          ) : null}
        </section>
        {isAdmin ? (
          <button
            className="database-records__cta"
            disabled={isSyncRunning}
            onClick={() => void handleHubspotObjectSync()}
            type="button"
          >
            {isSyncRunning ? "Syncing..." : "Sync from HubSpot"}
          </button>
        ) : null}
      </div>

      {isAdmin && syncStatus ? <p className="database-admin__sync-status" role="status">{syncStatus}</p> : null}

      <section className="database-admin__panel">
        {activeTab === "clients" ? (
          <ClientsWorkspace initialData={clients} />
        ) : activeTab === "dropdown-values" ? (
          <DropdownValuesWorkspace initialData={dropdownValues} />
        ) : activeTab === "hubspot" ? (
          <HubspotIntegrationWorkspace />
        ) : (
          <CampaignsWorkspace initialData={campaigns} />
        )}
      </section>
    </div>
  );
}
