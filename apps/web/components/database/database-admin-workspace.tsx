"use client";

import type { ListCampaignsResponse, ListClientsResponse } from "@scouting-platform/contracts";
import { useSearchParams, useRouter } from "next/navigation";
import React from "react";

import { CampaignsWorkspace } from "../campaigns/campaigns-workspace";
import { ClientsWorkspace } from "../database/clients-workspace";

export function DatabaseAdminWorkspace({
  campaigns,
  clients,
}: Readonly<{
  campaigns: ListCampaignsResponse;
  clients: ListClientsResponse;
}>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") === "campaigns" ? "campaigns" : "clients";

  function selectTab(tab: "clients" | "campaigns") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/database?${params.toString()}`);
  }

  return (
    <div className="database-admin">
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
      </section>

      {activeTab === "clients" ? <ClientsWorkspace initialData={clients} /> : <CampaignsWorkspace initialData={campaigns} />}
    </div>
  );
}
