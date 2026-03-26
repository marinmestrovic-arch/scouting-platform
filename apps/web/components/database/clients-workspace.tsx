"use client";

import type { ListClientsResponse } from "@scouting-platform/contracts";
import React, { useState } from "react";

import { createClientRequest } from "../../lib/clients-api";
import { COUNTRY_OPTIONS } from "../../lib/countries";

type ClientsWorkspaceProps = Readonly<{
  initialData: ListClientsResponse;
}>;

type ClientFormState = {
  name: string;
  domain: string;
  countryRegion: string;
  city: string;
};

export function ClientsWorkspace({ initialData }: ClientsWorkspaceProps) {
  const [items, setItems] = useState(initialData.items);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState<ClientFormState>({
    name: "",
    domain: "",
    countryRegion: COUNTRY_OPTIONS[0] ?? "",
    city: "",
  });
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateFormField<Key extends keyof ClientFormState>(field: Key, value: ClientFormState[Key]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

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
      setForm((current) => ({
        ...current,
        name: "",
        domain: "",
        city: "",
      }));
      setIsCreateOpen(false);
      setStatus("Client created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create client.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="clients-workspace">
      {initialData.permissions.canCreate ? (
        <div className="database-admin__header">
          <div>
            <h3>Clients</h3>
            <p className="workspace-copy">Browse client records and add a new client without leaving the table.</p>
          </div>
          <button className="database-admin__cta" onClick={() => setIsCreateOpen(true)} type="button">
            Add Client
          </button>
        </div>
      ) : null}

      {isCreateOpen ? (
        <div className="database-admin__modal-backdrop" onClick={() => setIsCreateOpen(false)} role="presentation">
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
              <button className="database-admin__modal-close" onClick={() => setIsCreateOpen(false)} type="button">
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

      <div className="campaigns-workspace__table-shell">
        <table className="dashboard-workspace__table">
          <thead>
            <tr>
              <th>Client name</th>
              <th>Client domain name</th>
              <th>Country/region</th>
              <th>City</th>
            </tr>
          </thead>
          <tbody>
            {items.map((client) => (
              <tr key={client.id}>
                <td>{client.name}</td>
                <td>{client.domain || "—"}</td>
                <td>{client.countryRegion || "—"}</td>
                <td>{client.city || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
