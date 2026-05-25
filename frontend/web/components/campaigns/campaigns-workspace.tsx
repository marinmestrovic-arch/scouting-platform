"use client";

import type { CampaignSummary, ListCampaignsResponse, RunMonth } from "@scouting-platform/contracts";
import React, { useEffect, useMemo, useState } from "react";

import { MONTH_LABELS } from "../../lib/countries";
import {
  createCampaignRequest,
  deleteCampaignRequest,
  updateCampaignRequest,
} from "../../lib/campaigns-api";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";

type CampaignsWorkspaceProps = Readonly<{
  initialData: ListCampaignsResponse;
}>;

type CampaignFormState = {
  name: string;
  clientId: string;
  marketId: string;
  month: RunMonth;
  year: string;
  isActive: boolean;
};

type RecordStatusFilter = "active" | "archived";

type CampaignFiltersState = {
  clientId: string;
  marketId: string;
  status: RecordStatusFilter;
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

function formatSyncDate(value: string | null | undefined): string {
  if (!value) {
    return "Synced";
  }

  return `Synced ${value.slice(0, 10)}`;
}

function isArchivedCampaign(campaign: CampaignSummary): boolean {
  return campaign.hubspotArchived === true || !campaign.isActive;
}

function isLocalCampaign(campaign: CampaignSummary): boolean {
  return !campaign.hubspotObjectId && !campaign.hubspotObjectType && !campaign.hubspotSyncedAt;
}

function createEmptyCampaignForm(): CampaignFormState {
  return {
    name: "",
    clientId: "",
    marketId: "",
    month: "january",
    year: String(new Date().getUTCFullYear()),
    isActive: true,
  };
}

function toCampaignForm(campaign: CampaignSummary): CampaignFormState {
  return {
    name: campaign.name,
    clientId: campaign.client?.id ?? "",
    marketId: campaign.market?.id ?? "",
    month: campaign.month ?? "january",
    year: String(campaign.year ?? new Date().getUTCFullYear()),
    isActive: campaign.isActive,
  };
}

export function CampaignsWorkspace({ initialData }: CampaignsWorkspaceProps) {
  const [items, setItems] = useState(initialData.items);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<CampaignSummary | null>(null);
  const [filters, setFilters] = useState<CampaignFiltersState>({
    clientId: "",
    marketId: "",
    status: "active",
  });
  const [form, setForm] = useState<CampaignFormState>(() => createEmptyCampaignForm());
  const [editForm, setEditForm] = useState<CampaignFormState>(() => createEmptyCampaignForm());
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const canManageLocalCampaigns = initialData.permissions.canCreate;

  useEffect(() => {
    setItems(initialData.items);
  }, [initialData.items]);
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
    { value: "", label: "No markets" },
    ...initialData.filterOptions.markets.map((market) => ({
      value: market.id,
      label: market.name,
    })),
  ];

  function updateFilters<Key extends keyof CampaignFiltersState>(
    field: Key,
    value: CampaignFiltersState[Key],
  ) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function updateFormField<Key extends keyof CampaignFormState>(field: Key, value: CampaignFormState[Key]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateEditFormField<Key extends keyof CampaignFormState>(
    field: Key,
    value: CampaignFormState[Key],
  ) {
    setEditForm((current) => ({ ...current, [field]: value }));
  }

  function openCreateCampaign() {
    setEditingCampaign(null);
    setStatus("");
    setIsCreateOpen(true);
  }

  function closeCreateCampaign() {
    setIsCreateOpen(false);
  }

  function openEditCampaign(campaign: CampaignSummary) {
    if (!canManageLocalCampaigns || !isLocalCampaign(campaign)) {
      return;
    }

    setIsCreateOpen(false);
    setEditForm(toCampaignForm(campaign));
    setEditingCampaign(campaign);
    setStatus("");
  }

  function closeEditCampaign() {
    setEditingCampaign(null);
  }

  const filteredItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (filters.status === "archived" ? isArchivedCampaign(item) : !isArchivedCampaign(item)) &&
          (!filters.clientId || item.client?.id === filters.clientId) &&
          (!filters.marketId || item.market?.id === filters.marketId),
      ),
    [filters.clientId, filters.marketId, filters.status, items],
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

      const year = Number.parseInt(form.year, 10);

      if (!Number.isFinite(year)) {
        throw new Error("Year is required.");
      }

      const created = await createCampaignRequest({
        name: form.name,
        clientId: form.clientId,
        marketId: form.marketId || undefined,
        month: form.month,
        year,
        isActive: form.isActive,
      });

      setItems((current) => [created, ...current]);
      setForm(createEmptyCampaignForm());
      closeCreateCampaign();
      setStatus("Campaign created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create campaign.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpdateCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingCampaign) {
      return;
    }

    setIsSubmitting(true);
    setStatus("");

    try {
      if (!editForm.name.trim()) {
        throw new Error("Campaign name is required.");
      }

      if (!editForm.clientId) {
        throw new Error("Client is required.");
      }

      const year = Number.parseInt(editForm.year, 10);

      if (!Number.isFinite(year)) {
        throw new Error("Year is required.");
      }

      const updated = await updateCampaignRequest(editingCampaign.id, {
        name: editForm.name,
        clientId: editForm.clientId,
        marketId: editForm.marketId || undefined,
        month: editForm.month,
        year,
        isActive: editForm.isActive,
      });

      setItems((current) =>
        current.map((campaign) => (campaign.id === updated.id ? updated : campaign)),
      );
      closeEditCampaign();
      setStatus("Campaign updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update campaign.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteCampaign(campaign: CampaignSummary) {
    if (!canManageLocalCampaigns || !isLocalCampaign(campaign)) {
      return;
    }

    const shouldDelete =
      typeof globalThis.confirm === "function"
        ? globalThis.confirm(`Delete campaign "${campaign.name}"?`)
        : true;

    if (!shouldDelete) {
      return;
    }

    setPendingDeleteId(campaign.id);
    setStatus("");

    try {
      await deleteCampaignRequest(campaign.id);
      setItems((current) => current.filter((item) => item.id !== campaign.id));

      if (editingCampaign?.id === campaign.id) {
        closeEditCampaign();
      }

      setStatus("Campaign deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete campaign.");
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <div className="campaigns-workspace">
      <section className="database-records__filters">
        <div className="new-scouting__field">
          <span>Status</span>
          <div className="database-records__status-filter" role="group" aria-label="Campaign status">
            <button
              aria-pressed={filters.status === "active"}
              className="status-pill-button"
              onClick={() => updateFilters("status", "active")}
              type="button"
            >
              <span className="status-pill status-pill--completed">Active</span>
            </button>
            <button
              aria-pressed={filters.status === "archived"}
              className="status-pill-button"
              onClick={() => updateFilters("status", "archived")}
              type="button"
            >
              <span className="status-pill status-pill--neutral">Archived</span>
            </button>
          </div>
        </div>

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
          <span>Markets</span>
          <SearchableSelect
            ariaLabel="Markets"
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
          <p className="workspace-copy">Browse campaigns you can scout for.</p>
        </div>
        {initialData.permissions.canCreate ? (
          <button className="database-records__cta" onClick={openCreateCampaign} type="button">
            Add Campaign
          </button>
        ) : null}
      </div>

      {isCreateOpen ? (
        <div className="database-admin__modal-backdrop" onClick={closeCreateCampaign} role="presentation">
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
              <button className="database-admin__modal-close" onClick={closeCreateCampaign} type="button">
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
                  <span>Markets</span>
                  <SearchableSelect
                    ariaLabel="Markets"
                    onChange={(value) => updateFormField("marketId", value)}
                    options={createMarketOptions}
                    placeholder="No markets"
                    searchPlaceholder="Search markets..."
                    value={form.marketId}
                  />
                </label>
              </div>
              <div className="new-scouting__grid new-scouting__grid--three">
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

      {editingCampaign ? (
        <div className="database-admin__modal-backdrop" onClick={closeEditCampaign} role="presentation">
          <div
            aria-labelledby="edit-campaign-title"
            aria-modal="true"
            className="database-admin__modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="database-admin__modal-header">
              <div>
                <p className="workspace-eyebrow">Database</p>
                <h3 id="edit-campaign-title">Edit campaign</h3>
              </div>
              <button className="database-admin__modal-close" onClick={closeEditCampaign} type="button">
                Close
              </button>
            </div>

            <form className="campaigns-workspace__form campaigns-workspace__form--modal" onSubmit={handleUpdateCampaign}>
              <div className="new-scouting__grid new-scouting__grid--three">
                <label className="new-scouting__field">
                  <span>Campaign Name</span>
                  <input
                    onChange={(event) => updateEditFormField("name", event.currentTarget.value)}
                    required
                    value={editForm.name}
                  />
                </label>
                <label className="new-scouting__field">
                  <span>Client</span>
                  <SearchableSelect
                    ariaLabel="Client"
                    onChange={(value) => updateEditFormField("clientId", value)}
                    options={createClientOptions}
                    placeholder="Select client"
                    searchPlaceholder="Search clients..."
                    value={editForm.clientId}
                  />
                </label>
                <label className="new-scouting__field">
                  <span>Markets</span>
                  <SearchableSelect
                    ariaLabel="Markets"
                    onChange={(value) => updateEditFormField("marketId", value)}
                    options={createMarketOptions}
                    placeholder="No markets"
                    searchPlaceholder="Search markets..."
                    value={editForm.marketId}
                  />
                </label>
              </div>
              <div className="new-scouting__grid new-scouting__grid--three">
                <label className="new-scouting__field">
                  <span>Month</span>
                  <select
                    onChange={(event) => updateEditFormField("month", event.currentTarget.value as RunMonth)}
                    value={editForm.month}
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
                    onChange={(event) => updateEditFormField("year", event.currentTarget.value)}
                    required
                    type="number"
                    value={editForm.year}
                  />
                </label>
                <label className="new-scouting__field database-records__checkbox-field">
                  <span>Active</span>
                  <input
                    checked={editForm.isActive}
                    onChange={(event) => updateEditFormField("isActive", event.currentTarget.checked)}
                    type="checkbox"
                  />
                </label>
              </div>

              <div className="campaigns-workspace__form-actions">
                <button className="database-admin__cta" disabled={isSubmitting} type="submit">
                  {isSubmitting ? "Saving..." : "Save Campaign"}
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
              <th>Markets</th>
              <th>Month</th>
              <th>Year</th>
              <th>Status</th>
              <th>HubSpot</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((campaign: CampaignSummary) => {
              const isArchived = isArchivedCampaign(campaign);
              const isLocal = isLocalCampaign(campaign);

              return (
                <tr key={campaign.id}>
                  <td className="database-records__strong-cell">
                    {canManageLocalCampaigns && isLocal ? (
                      <button
                        className="database-records__name-button"
                        onClick={() => openEditCampaign(campaign)}
                        type="button"
                      >
                        {campaign.name}
                      </button>
                    ) : (
                      campaign.name
                    )}
                  </td>
                  <td>{campaign.client?.name ?? "—"}</td>
                  <td>{campaign.market?.name ?? "—"}</td>
                  <td>{campaign.month ? MONTH_LABELS[campaign.month] : "—"}</td>
                  <td>{campaign.year ?? "—"}</td>
                  <td>
                    <span className={isArchived ? "database-records__status" : "database-records__status database-records__status--active"}>
                      {isArchived ? "Archived" : "Active"}
                    </span>
                  </td>
                  <td className="database-records__muted-cell">
                    {campaign.hubspotObjectId ? (
                      <span title={campaign.hubspotObjectType ?? undefined}>
                        {formatSyncDate(campaign.hubspotSyncedAt)}
                      </span>
                    ) : (
                      "Local"
                    )}
                  </td>
                  <td>
                    {canManageLocalCampaigns && isLocal ? (
                      <button
                        className="database-records__action-button"
                        disabled={pendingDeleteId === campaign.id}
                        onClick={() => void handleDeleteCampaign(campaign)}
                        type="button"
                      >
                        {pendingDeleteId === campaign.id ? "Deleting..." : "Delete"}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
