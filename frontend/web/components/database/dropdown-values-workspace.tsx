"use client";

import type { DropdownValue, DropdownValueFieldKey } from "@scouting-platform/contracts";
import React, { useMemo, useState } from "react";

import {
  groupDropdownValuesByField,
  isHubspotSyncedDropdownField,
  isPlatformManagedDropdownField,
  replaceDropdownValuesRequest,
  syncHubspotDropdownValuesRequest,
} from "../../lib/dropdown-values-api";

type DropdownValuesWorkspaceProps = Readonly<{
  initialData: DropdownValue[];
}>;

const FIELD_LABELS: Record<DropdownValueFieldKey, string> = {
  currency: "Currency",
  dealType: "Deal Type",
  activationType: "Activation Type",
  influencerType: "Influencer Type",
  influencerVertical: "Influencer Vertical",
  countryRegion: "Country/Region",
  language: "Language",
};

export function DropdownValuesWorkspace({ initialData }: DropdownValuesWorkspaceProps) {
  const [items, setItems] = useState(initialData);
  const [status, setStatus] = useState("");
  const [activeField, setActiveField] = useState<DropdownValueFieldKey | null>(null);
  const [textareaValue, setTextareaValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const grouped = useMemo(() => groupDropdownValuesByField(items), [items]);

  function openField(fieldKey: DropdownValueFieldKey) {
    setActiveField(fieldKey);
    setTextareaValue(grouped[fieldKey].join("\n"));
    setStatus("");
  }

  async function handleSave() {
    if (!activeField) {
      return;
    }

    setIsSaving(true);
    setStatus("");

    try {
      const updatedItems = await replaceDropdownValuesRequest({
        fieldKey: activeField,
        values: textareaValue
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      setItems(updatedItems);
      setStatus(`${FIELD_LABELS[activeField]} values saved.`);
      setActiveField(null);
      setTextareaValue("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save dropdown values.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleHubspotSync() {
    setIsSyncing(true);
    setStatus("");

    try {
      const updatedItems = await syncHubspotDropdownValuesRequest();
      setItems(updatedItems);
      setActiveField(null);
      setTextareaValue("");
      setStatus("HubSpot dropdown values synced.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to sync HubSpot dropdown values.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div className="database-records">
      <div className="database-records__header">
        <div>
          <h2>Dropdown Values</h2>
          <p className="workspace-copy">
            Sync HubSpot dropdowns to refresh Currency, Deal Type, Activation Type, Country/Region,
            and Language from HubSpot. Influencer Type and Influencer Vertical are built into the
            platform.
          </p>
        </div>
        <button
          className="database-records__cta"
          disabled={isSyncing}
          onClick={() => void handleHubspotSync()}
          type="button"
        >
          {isSyncing ? "Syncing..." : "Sync HubSpot dropdowns"}
        </button>
      </div>

      {status ? <p role="status">{status}</p> : null}

      <div className="database-records__table-shell">
        <table className="database-records__table">
          <thead>
            <tr>
              <th>Property</th>
              <th>Configured values</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(FIELD_LABELS) as DropdownValueFieldKey[]).map((fieldKey) => (
              <tr key={fieldKey}>
                <td className="database-records__strong-cell">{FIELD_LABELS[fieldKey]}</td>
                <td>{grouped[fieldKey].length}</td>
                <td>
                  {isHubspotSyncedDropdownField(fieldKey) ? (
                    <span className="workspace-copy">Synced from HubSpot</span>
                  ) : isPlatformManagedDropdownField(fieldKey) ? (
                    <span className="workspace-copy">Built into platform</span>
                  ) : (
                    <button
                      className="workspace-button workspace-button--secondary workspace-button--small"
                      onClick={() => openField(fieldKey)}
                      type="button"
                    >
                      Edit values
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activeField ? (
        <div className="database-admin__modal-backdrop" onClick={() => setActiveField(null)} role="presentation">
          <div
            aria-labelledby="dropdown-values-modal-title"
            aria-modal="true"
            className="database-admin__modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="database-admin__modal-header">
              <div>
                <p className="workspace-eyebrow">Database</p>
                <h3 id="dropdown-values-modal-title">{FIELD_LABELS[activeField]}</h3>
              </div>
              <button className="database-admin__modal-close" onClick={() => setActiveField(null)} type="button">
                Close
              </button>
            </div>

            <div className="campaigns-workspace__form campaigns-workspace__form--modal">
              <label className="new-scouting__field">
                <span>Possible values</span>
                <textarea
                  onChange={(event) => setTextareaValue(event.currentTarget.value)}
                  placeholder="One value per line"
                  rows={14}
                  value={textareaValue}
                />
              </label>
              <p className="workspace-copy">Each non-empty line becomes one dropdown option.</p>
              <div className="campaigns-workspace__form-actions">
                <button className="database-records__cta" disabled={isSaving} onClick={() => void handleSave()} type="button">
                  {isSaving ? "Saving..." : "Save values"}
                </button>
                <button
                  className="workspace-button workspace-button--secondary"
                  onClick={() => setActiveField(null)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
