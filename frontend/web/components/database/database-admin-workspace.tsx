"use client";

import type {
  DropdownValue,
  ListCampaignsResponse,
  ListClientsResponse,
} from "@scouting-platform/contracts";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import React from "react";

const CampaignsWorkspace = dynamic(
  () => import("../campaigns/campaigns-workspace").then((mod) => mod.CampaignsWorkspace),
);
const ClientsWorkspace = dynamic(
  () => import("../database/clients-workspace").then((mod) => mod.ClientsWorkspace),
);
const DropdownValuesWorkspace = dynamic(
  () => import("./dropdown-values-workspace").then((mod) => mod.DropdownValuesWorkspace),
);

export function DatabaseAdminWorkspace({
  campaigns,
  clients,
  dropdownValues,
  isAdmin,
}: Readonly<{
  campaigns: ListCampaignsResponse;
  clients: ListClientsResponse;
  dropdownValues: DropdownValue[];
  isAdmin: boolean;
}>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab =
    requestedTab === "campaigns"
      ? "campaigns"
      : requestedTab === "dropdown-values" && isAdmin
        ? "dropdown-values"
        : "clients";

  function selectTab(tab: "clients" | "campaigns" | "dropdown-values") {
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
        {isAdmin ? (
          <button
            className={activeTab === "dropdown-values" ? "database-admin__tab database-admin__tab--active" : "database-admin__tab"}
            onClick={() => selectTab("dropdown-values")}
            type="button"
          >
            Dropdown Values
          </button>
        ) : null}
      </section>

      <section className="database-admin__panel">
        {activeTab === "clients" ? (
          <ClientsWorkspace initialData={clients} />
        ) : activeTab === "dropdown-values" ? (
          <DropdownValuesWorkspace initialData={dropdownValues} />
        ) : (
          <CampaignsWorkspace initialData={campaigns} />
        )}
      </section>
    </div>
  );
}
