"use client";

import type { ClientSummary, ListClientsResponse } from "@scouting-platform/contracts";
import React, { useEffect, useState } from "react";

import {
  createClientRequest,
  deleteClientRequest,
  updateClientRequest,
} from "../../lib/clients-api";
import { COUNTRY_OPTIONS } from "../../lib/countries";

type ClientsWorkspaceProps = Readonly<{
  initialData: ListClientsResponse;
}>;

type ClientFormState = {
  name: string;
  domain: string;
  countryRegion: string;
  city: string;
  isActive: boolean;
};

type RecordStatusFilter = "active" | "archived";

function formatSyncDate(value: string | null | undefined): string {
  if (!value) {
    return "Synced";
  }

  return `Synced ${value.slice(0, 10)}`;
}

function isArchivedClient(client: ListClientsResponse["items"][number]): boolean {
  return client.hubspotArchived === true || !(client.isActive ?? true);
}

function isLocalClient(client: ClientSummary): boolean {
  return !client.hubspotObjectId && !client.hubspotObjectType && !client.hubspotSyncedAt;
}

function createEmptyClientForm(): ClientFormState {
  return {
    name: "",
    domain: "",
    countryRegion: COUNTRY_OPTIONS[0] ?? "",
    city: "",
    isActive: true,
  };
}

function toClientForm(client: ClientSummary): ClientFormState {
  return {
    name: client.name,
    domain: client.domain ?? "",
    countryRegion: client.countryRegion ?? COUNTRY_OPTIONS[0] ?? "",
    city: client.city ?? "",
    isActive: client.isActive ?? true,
  };
}

export function ClientsWorkspace({ initialData }: ClientsWorkspaceProps) {
  const [items, setItems] = useState(initialData.items);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecordStatusFilter>("active");
  const [form, setForm] = useState<ClientFormState>(() => createEmptyClientForm());
  const [editForm, setEditForm] = useState<ClientFormState>(() => createEmptyClientForm());
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const canManageLocalClients = initialData.permissions.canCreate;

  useEffect(() => {
    setItems(initialData.items);
  }, [initialData.items]);

  function updateFormField<Key extends keyof ClientFormState>(field: Key, value: ClientFormState[Key]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateEditFormField<Key extends keyof ClientFormState>(
    field: Key,
    value: ClientFormState[Key],
  ) {
    setEditForm((current) => ({ ...current, [field]: value }));
  }

  function openCreateClient() {
    setEditingClient(null);
    setStatus("");
    setIsCreateOpen(true);
  }

  function closeCreateClient() {
    setIsCreateOpen(false);
  }

  function openEditClient(client: ClientSummary) {
    if (!canManageLocalClients || !isLocalClient(client)) {
      return;
    }

    setIsCreateOpen(false);
    setEditForm(toClientForm(client));
    setEditingClient(client);
    setStatus("");
  }

  function closeEditClient() {
    setEditingClient(null);
  }

  const filteredItems = items.filter((item) =>
    statusFilter === "archived" ? isArchivedClient(item) : !isArchivedClient(item),
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus("");

    try {
      const created = await createClientRequest({
        name: form.name,
        domain: form.domain.trim() || undefined,
        countryRegion: form.countryRegion,
        city: form.city,
      });

      setItems((current) => [created, ...current]);
      setForm(createEmptyClientForm());
      closeCreateClient();
      setStatus("Client created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create client.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpdateClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingClient) {
      return;
    }

    setIsSubmitting(true);
    setStatus("");

    try {
      const updated = await updateClientRequest(editingClient.id, {
        name: editForm.name,
        domain: editForm.domain.trim() || undefined,
        countryRegion: editForm.countryRegion,
        city: editForm.city,
        isActive: editForm.isActive,
      });

      setItems((current) => current.map((client) => (client.id === updated.id ? updated : client)));
      closeEditClient();
      setStatus("Client updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update client.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteClient(client: ClientSummary) {
    if (!canManageLocalClients || !isLocalClient(client)) {
      return;
    }

    const shouldDelete =
      typeof globalThis.confirm === "function"
        ? globalThis.confirm(`Delete client "${client.name}"?`)
        : true;

    if (!shouldDelete) {
      return;
    }

    setPendingDeleteId(client.id);
    setStatus("");

    try {
      await deleteClientRequest(client.id);
      setItems((current) => current.filter((item) => item.id !== client.id));

      if (editingClient?.id === client.id) {
        closeEditClient();
      }

      setStatus("Client deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete client.");
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <div className="clients-workspace">
      <section className="database-records__filters">
        <div className="new-scouting__field">
          <span>Status</span>
          <div className="database-records__status-filter" role="group" aria-label="Client status">
            <button
              aria-pressed={statusFilter === "active"}
              className="status-pill-button"
              onClick={() => setStatusFilter("active")}
              type="button"
            >
              <span className="status-pill status-pill--completed">Active</span>
            </button>
            <button
              aria-pressed={statusFilter === "archived"}
              className="status-pill-button"
              onClick={() => setStatusFilter("archived")}
              type="button"
            >
              <span className="status-pill status-pill--neutral">Archived</span>
            </button>
          </div>
        </div>
      </section>

      <div className="database-records__header">
        <div>
          <h2>Clients</h2>
          <p className="workspace-copy">Browse client records.</p>
        </div>
        {initialData.permissions.canCreate ? (
          <button className="database-records__cta" onClick={openCreateClient} type="button">
            Add Client
          </button>
        ) : null}
      </div>

      {isCreateOpen ? (
        <div className="database-admin__modal-backdrop" onClick={closeCreateClient} role="presentation">
          <div
            aria-labelledby="create-client-title"
            aria-modal="true"
            className="database-admin__modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="database-admin__modal-header">
              <div>
                <p className="workspace-eyebrow">Database</p>
                <h3 id="create-client-title">Create client</h3>
              </div>
              <button className="database-admin__modal-close" onClick={closeCreateClient} type="button">
                Close
              </button>
            </div>

            <form className="campaigns-workspace__form campaigns-workspace__form--modal" onSubmit={handleSubmit} suppressHydrationWarning>
              <div className="new-scouting__grid new-scouting__grid--three">
                <label className="new-scouting__field">
                  <span>Client name</span>
                  <input
                    onChange={(event) => updateFormField("name", event.currentTarget.value)}
                    required
                    suppressHydrationWarning
                    value={form.name}
                  />
                </label>
                <label className="new-scouting__field">
                  <span>Client domain name</span>
                  <input
                    onChange={(event) => updateFormField("domain", event.currentTarget.value)}
                    suppressHydrationWarning
                    value={form.domain}
                  />
                </label>
                <label className="new-scouting__field">
                  <span>Country/region</span>
                  <select
                    onChange={(event) => updateFormField("countryRegion", event.currentTarget.value)}
                    suppressHydrationWarning
                    value={form.countryRegion}
                  >
                    {COUNTRY_OPTIONS.map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="new-scouting__grid new-scouting__grid--two">
                <label className="new-scouting__field">
                  <span>City</span>
                  <input
                    onChange={(event) => updateFormField("city", event.currentTarget.value)}
                    required
                    suppressHydrationWarning
                    value={form.city}
                  />
                </label>
              </div>

              <div className="campaigns-workspace__form-actions">
                <button className="database-admin__cta" disabled={isSubmitting} suppressHydrationWarning type="submit">
                  {isSubmitting ? "Creating..." : "Add Client"}
                </button>
                {status ? <p role="status">{status}</p> : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingClient ? (
        <div className="database-admin__modal-backdrop" onClick={closeEditClient} role="presentation">
          <div
            aria-labelledby="edit-client-title"
            aria-modal="true"
            className="database-admin__modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="database-admin__modal-header">
              <div>
                <p className="workspace-eyebrow">Database</p>
                <h3 id="edit-client-title">Edit client</h3>
              </div>
              <button className="database-admin__modal-close" onClick={closeEditClient} type="button">
                Close
              </button>
            </div>

            <form className="campaigns-workspace__form campaigns-workspace__form--modal" onSubmit={handleUpdateClient} suppressHydrationWarning>
              <div className="new-scouting__grid new-scouting__grid--three">
                <label className="new-scouting__field">
                  <span>Client name</span>
                  <input
                    onChange={(event) => updateEditFormField("name", event.currentTarget.value)}
                    required
                    suppressHydrationWarning
                    value={editForm.name}
                  />
                </label>
                <label className="new-scouting__field">
                  <span>Client domain name</span>
                  <input
                    onChange={(event) => updateEditFormField("domain", event.currentTarget.value)}
                    suppressHydrationWarning
                    value={editForm.domain}
                  />
                </label>
                <label className="new-scouting__field">
                  <span>Country/region</span>
                  <select
                    onChange={(event) => updateEditFormField("countryRegion", event.currentTarget.value)}
                    suppressHydrationWarning
                    value={editForm.countryRegion}
                  >
                    {COUNTRY_OPTIONS.map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="new-scouting__grid new-scouting__grid--two">
                <label className="new-scouting__field">
                  <span>City</span>
                  <input
                    onChange={(event) => updateEditFormField("city", event.currentTarget.value)}
                    required
                    suppressHydrationWarning
                    value={editForm.city}
                  />
                </label>
                <label className="new-scouting__field database-records__checkbox-field">
                  <span>Active</span>
                  <input
                    checked={editForm.isActive}
                    onChange={(event) => updateEditFormField("isActive", event.currentTarget.checked)}
                    suppressHydrationWarning
                    type="checkbox"
                  />
                </label>
              </div>

              <div className="campaigns-workspace__form-actions">
                <button className="database-admin__cta" disabled={isSubmitting} suppressHydrationWarning type="submit">
                  {isSubmitting ? "Saving..." : "Save Client"}
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
              <th>Client name</th>
              <th>Client domain name</th>
              <th>Country/region</th>
              <th>City</th>
              <th>Status</th>
              <th>HubSpot</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((client) => {
              const isArchived = isArchivedClient(client);
              const isLocal = isLocalClient(client);

              return (
                <tr key={client.id}>
                  <td className="database-records__strong-cell">
                    {canManageLocalClients && isLocal ? (
                      <button
                        className="database-records__name-button"
                        onClick={() => openEditClient(client)}
                        type="button"
                      >
                        {client.name}
                      </button>
                    ) : (
                      client.name
                    )}
                  </td>
                  <td className="database-records__muted-cell">{client.domain || "—"}</td>
                  <td>{client.countryRegion || "—"}</td>
                  <td>{client.city || "—"}</td>
                  <td>
                    <span className={isArchived ? "database-records__status" : "database-records__status database-records__status--active"}>
                      {isArchived ? "Archived" : "Active"}
                    </span>
                  </td>
                  <td className="database-records__muted-cell">
                    {client.hubspotObjectId ? (
                      <span title={client.hubspotObjectType ?? undefined}>
                        {formatSyncDate(client.hubspotSyncedAt)}
                      </span>
                    ) : (
                      "Local"
                    )}
                  </td>
                  <td>
                    {canManageLocalClients && isLocal ? (
                      <button
                        className="database-records__action-button"
                        disabled={pendingDeleteId === client.id}
                        onClick={() => void handleDeleteClient(client)}
                        type="button"
                      >
                        {pendingDeleteId === client.id ? "Deleting..." : "Delete"}
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
