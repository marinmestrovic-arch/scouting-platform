"use client";

import type { CampaignSummary, ListCampaignsResponse, RunMonth } from "@scouting-platform/contracts";
import React, { useMemo, useState } from "react";

import { MONTH_LABELS } from "../../lib/countries";
import { createCampaignRequest } from "../../lib/campaigns-api";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";

type CampaignsWorkspaceProps = Readonly<{
  initialData: ListCampaignsResponse;
}>;

type CampaignFormState = {
  name: string;
  clientId: string;
  marketId: string;
  briefLink: string;
  month: RunMonth;
  year: string;
  isActive: boolean;
};

const MONTH_OPTIONS: RunMonth[] = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export function CampaignsWorkspace({ initialData }: CampaignsWorkspaceProps) {
  const [items, setItems] = useState(initialData.items);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [filters, setFilters] = useState({
    clientId: "",
    marketId: "",
  });
  const [form, setForm] = useState<CampaignFormState>({
    name: "",
    clientId: "",
    marketId: "",
    briefLink: "",
    month: "january",
    year: String(new Date().getUTCFullYear()),
    isActive: true,
  });
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const clientOptions: SearchableSelectOption[] = [
    { value: "", label: "All clients" },
    ...initialData.filterOptions.clients.map((client) => ({
      value: client.id,
      label: client.name,
    })),
  ];
  const marketOptions: SearchableSelectOption[] = [
    { value: "", label: "All markets" },
    ...initialData.filterOptions.markets.map((market) => ({
      value: market.id,
      label: market.name,
    })),
  ];
  const createClientOptions: SearchableSelectOption[] = [
    { value: "", label: "Select client" },
    ...initialData.filterOptions.clients.map((client) => ({
      value: client.id,
      label: client.name,
    })),
  ];
  const createMarketOptions: SearchableSelectOption[] = [
    { value: "", label: "Select market" },
    ...initialData.filterOptions.markets.map((market) => ({
      value: market.id,
      label: market.name,
    })),
  ];

  function updateFilters(field: "clientId" | "marketId", value: string) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function updateFormField<Key extends keyof CampaignFormState>(field: Key, value: CampaignFormState[Key]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const filteredItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (!filters.clientId || item.client.id === filters.clientId) &&
          (!filters.marketId || item.market.id === filters.marketId),
      ),
    [filters.clientId, filters.marketId, items],
  );

  async function handleCreateCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus("");

    try {
      if (!form.name.trim()) {
        throw new Error("Campaign name is required.");
      }

      if (!form.clientId) {
        throw new Error("Client is required.");
      }

      if (!form.marketId) {
        throw new Error("Market is required.");
      }

      const year = Number.parseInt(form.year, 10);

      if (!Number.isFinite(year)) {
        throw new Error("Year is required.");
      }

      const created = await createCampaignRequest({
        name: form.name,
        clientId: form.clientId,
        marketId: form.marketId,
        briefLink: form.briefLink.trim() || undefined,
        month: form.month,
        year,
        isActive: form.isActive,
      });

      setItems((current) => [created, ...current]);
      setForm((current) => ({
        ...current,
        name: "",
        clientId: "",
        marketId: "",
        briefLink: "",
      }));
      setIsCreateOpen(false);
      setStatus("Campaign created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create campaign.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="campaigns-workspace">
      <section className="database-records__filters">
        <label className="new-scouting__field">
          <span>Client</span>
          <SearchableSelect
            ariaLabel="Client"
            onChange={(value) => updateFilters("clientId", value)}
            options={clientOptions}
            placeholder="All clients"
            searchPlaceholder="Search clients..."
            value={filters.clientId}
          />
        </label>

        <label className="new-scouting__field">
          <span>Market</span>
          <SearchableSelect
            ariaLabel="Market"
            onChange={(value) => updateFilters("marketId", value)}
            options={marketOptions}
            placeholder="All markets"
            searchPlaceholder="Search markets..."
            value={filters.marketId}
          />
        </label>
      </section>

      <div className="database-records__header">
        <div>
          <h2>Campaigns</h2>
          <p className="workspace-copy">View and manage active campaigns in the shared database workspace.</p>
        </div>
        {initialData.permissions.canCreate ? (
          <button className="database-records__cta" onClick={() => setIsCreateOpen(true)} type="button">
            Add Campaign
          </button>
        ) : null}
      </div>

      {isCreateOpen ? (
        <div className="database-admin__modal-backdrop" onClick={() => setIsCreateOpen(false)} role="presentation">
          <div
            aria-labelledby="create-campaign-title"
            aria-modal="true"
            className="database-admin__modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="database-admin__modal-header">
              <div>
                <p className="workspace-eyebrow">Database</p>
                <h3 id="create-campaign-title">Create campaign</h3>
              </div>
              <button className="database-admin__modal-close" onClick={() => setIsCreateOpen(false)} type="button">
                Close
              </button>
            </div>

            <form className="campaigns-workspace__form campaigns-workspace__form--modal" onSubmit={handleCreateCampaign}>
              <div className="new-scouting__grid new-scouting__grid--three">
                <label className="new-scouting__field">
                  <span>Campaign Name</span>
                  <input
                    onChange={(event) => updateFormField("name", event.currentTarget.value)}
                    required
                    value={form.name}
                  />
                </label>
                <label className="new-scouting__field">
                  <span>Client</span>
                  <SearchableSelect
                    ariaLabel="Client"
                    onChange={(value) => updateFormField("clientId", value)}
                    options={createClientOptions}
                    placeholder="Select client"
                    searchPlaceholder="Search clients..."
                    value={form.clientId}
                  />
                </label>
                <label className="new-scouting__field">
                  <span>Market</span>
                  <SearchableSelect
                    ariaLabel="Market"
                    onChange={(value) => updateFormField("marketId", value)}
                    options={createMarketOptions}
                    placeholder="Select market"
                    searchPlaceholder="Search markets..."
                    value={form.marketId}
                  />
                </label>
              </div>
              <div className="new-scouting__grid new-scouting__grid--three">
                <label className="new-scouting__field">
                  <span>Brief Link</span>
                  <input
                    onChange={(event) => updateFormField("briefLink", event.currentTarget.value)}
                    type="url"
                    value={form.briefLink}
                  />
                </label>
                <label className="new-scouting__field">
                  <span>Month</span>
                  <select
                    onChange={(event) => updateFormField("month", event.currentTarget.value as RunMonth)}
                    value={form.month}
                  >
                    {MONTH_OPTIONS.map((month) => (
                      <option key={month} value={month}>
                        {MONTH_LABELS[month]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="new-scouting__field">
                  <span>Year</span>
                  <input
                    onChange={(event) => updateFormField("year", event.currentTarget.value)}
                    required
                    type="number"
                    value={form.year}
                  />
                </label>
              </div>

              <div className="campaigns-workspace__form-actions">
                <button className="database-admin__cta" disabled={isSubmitting} type="submit">
                  {isSubmitting ? "Creating..." : "Add Campaign"}
                </button>
                {status ? <p role="status">{status}</p> : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div className="database-records__table-shell">
        <table className="database-records__table">
          <thead>
            <tr>
              <th>Campaign Name</th>
              <th>Client</th>
              <th>Market</th>
              <th>Brief Link</th>
              <th>Month</th>
              <th>Year</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((campaign: CampaignSummary) => (
              <tr key={campaign.id}>
                <td className="database-records__strong-cell">{campaign.name}</td>
                <td>{campaign.client.name}</td>
                <td>{campaign.market.name}</td>
                <td>
                  {campaign.briefLink ? (
                    <a className="database-records__link" href={campaign.briefLink} rel="noreferrer" target="_blank">
                      Open brief
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{MONTH_LABELS[campaign.month]}</td>
                <td>{campaign.year}</td>
                <td>
                  <span className={campaign.isActive ? "database-records__status database-records__status--active" : "database-records__status"}>
                    {campaign.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
