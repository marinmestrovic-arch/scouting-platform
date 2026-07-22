"use client";

import type {
  ExportRunToGoogleSheetsRequest,
  HubspotPrepClearField,
  HubspotPrepUpdateDefaults,
  HubspotPrepRowOverrideValues,
  HubspotPrepUpdateRequest,
  HubspotExportPreview,
} from "@scouting-platform/contracts";
import { HUBSPOT_CONTACT_IDENTITY_COLUMN_KEY } from "@scouting-platform/contracts";
import React, { useState } from "react";

import { updateHubspotExportPreview } from "../../lib/export-previews-api";
import { exportRunToGoogleSheets } from "../../lib/google-sheets-export-api";
import { HubspotSyncPanel } from "./hubspot-sync-panel";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";

type ExportPreparationWorkspaceProps = Readonly<{
  preview: HubspotExportPreview;
}>;

const RUN_DEFAULT_COLUMN_KEYS = new Set<keyof HubspotPrepUpdateDefaults>([
  "currency",
  "dealType",
  "activationType",
]);

const CONTACT_IDENTITY_FIELD_KEYS = new Set(["firstName", "lastName", "email"]);

type HubspotDrafts = {
  defaults: HubspotPrepUpdateDefaults;
  touchedDefaults: Set<keyof HubspotPrepUpdateDefaults>;
  rowValues: Record<string, Record<string, string>>;
  touchedRowFields: Record<string, Set<HubspotPrepClearField["field"]>>;
};

function createEmptyDrafts(): HubspotDrafts {
  return {
    defaults: {
      currency: "",
      dealType: "",
      activationType: "",
      influencerType: "",
      influencerVertical: "",
      countryRegion: "",
      language: "",
    },
    touchedDefaults: new Set(),
    rowValues: {},
    touchedRowFields: {},
  };
}

function createEmptyGoogleSheetsRequest(): ExportRunToGoogleSheetsRequest {
  return {
    spreadsheetIdOrUrl: "",
    sheetName: "",
  };
}

function getCurrentRowValue(drafts: HubspotDrafts, rowKey: string, field: string): string {
  return drafts.rowValues[rowKey]?.[field] ?? "";
}

function isTouchedRowField(
  drafts: HubspotDrafts,
  rowKey: string,
  field: HubspotPrepClearField["field"],
): boolean {
  return drafts.touchedRowFields[rowKey]?.has(field) ?? false;
}

function getDisplayRowValue(input: {
  drafts: HubspotDrafts;
  rowKey: string;
  field: HubspotPrepClearField["field"];
  currentValue: string;
}): string {
  if (!isTouchedRowField(input.drafts, input.rowKey, input.field)) {
    return input.currentValue;
  }

  return getCurrentRowValue(input.drafts, input.rowKey, input.field);
}

function buildRowDropdownOptions(input: {
  currentValue: string;
  label: string;
  options: readonly string[];
}): SearchableSelectOption[] {
  const selectableOptions = input.options.map((option) => ({
    value: option,
    label: option,
  }));

  const hasCurrentValue = input.currentValue.trim().length > 0;
  const hasCurrentOption = hasCurrentValue && input.options.includes(input.currentValue);

  return [
    {
      value: "",
      label: `Select ${input.label}`,
    },
    ...(!hasCurrentValue || hasCurrentOption
      ? []
      : [
          {
            value: input.currentValue,
            label: input.currentValue,
          },
        ]),
    ...selectableOptions,
  ];
}

export function ExportPreparationWorkspace({
  preview,
}: ExportPreparationWorkspaceProps) {
  const [currentPreview, setCurrentPreview] = useState(preview);
  const [drafts, setDrafts] = useState<HubspotDrafts>(() => createEmptyDrafts());
  const [requestState, setRequestState] = useState<"idle" | "saving" | "error">("idle");
  const [requestMessage, setRequestMessage] = useState("");
  const [googleSheetsRequest, setGoogleSheetsRequest] = useState<ExportRunToGoogleSheetsRequest>(
    createEmptyGoogleSheetsRequest(),
  );
  const [googleSheetsState, setGoogleSheetsState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [googleSheetsMessage, setGoogleSheetsMessage] = useState("");
  const validationIssues = currentPreview.validationIssues;
  const hasPendingChanges =
    Object.values(drafts.touchedRowFields).some((fields) => fields.size > 0) ||
    drafts.touchedDefaults.size > 0;
  const hasGoogleSheetsTarget =
    googleSheetsRequest.spreadsheetIdOrUrl.trim().length > 0 &&
    googleSheetsRequest.sheetName.trim().length > 0;
  const canExportToGoogleSheets =
    hasGoogleSheetsTarget &&
    googleSheetsState !== "saving" &&
    requestState !== "saving" &&
    !hasPendingChanges;
  const googleSheetsBlockingMessage =
    hasGoogleSheetsTarget && hasPendingChanges
      ? "Save your edits before exporting to Google Sheets."
      : null;

  function updateDefault(field: keyof HubspotPrepUpdateDefaults, value: string) {
    setDrafts((current) => ({
      ...current,
      defaults: {
        ...current.defaults,
        [field]: value,
      },
      touchedDefaults: new Set([...current.touchedDefaults, field]),
    }));
  }

  function updateRowValue(rowKey: string, field: HubspotPrepClearField["field"], value: string) {
    setDrafts((current) => {
      const nextRowValues = {
        ...current.rowValues,
        [rowKey]: {
          ...(current.rowValues[rowKey] ?? {}),
          [field]: value,
        },
      };
      const nextTouchedFields = new Set(current.touchedRowFields[rowKey] ?? []);
      nextTouchedFields.add(field);

      return {
        ...current,
        rowValues: nextRowValues,
        touchedRowFields: {
          ...current.touchedRowFields,
          [rowKey]: nextTouchedFields,
        },
      };
    });
  }

  async function handleSave() {
    const rowOverrides = Object.entries(drafts.touchedRowFields)
      .map(([rowKey, fields]) => {
        const values = [...fields].reduce<HubspotPrepRowOverrideValues>((current, field) => {
          const nextValue = drafts.rowValues[rowKey]?.[field] ?? "";

          if (nextValue.trim()) {
            current[field] = nextValue;
          }

          return current;
        }, {});

        return {
          rowKey,
          values,
        };
      })
      .filter((item) => Object.keys(item.values).length > 0);

    const clearedFields = Object.entries(drafts.touchedRowFields).flatMap(([rowKey, fields]) =>
      [...fields].flatMap((field) => {
        const nextValue = drafts.rowValues[rowKey]?.[field] ?? "";

        return nextValue.trim()
          ? []
          : [
              {
                rowKey,
                field,
              },
            ];
      }),
    );

    const payload: HubspotPrepUpdateRequest = {
      defaults: {
        currency: drafts.touchedDefaults.has("currency")
          ? drafts.defaults.currency
          : (currentPreview.defaults.currency ?? ""),
        dealType: drafts.touchedDefaults.has("dealType")
          ? drafts.defaults.dealType
          : (currentPreview.defaults.dealType ?? ""),
        activationType: drafts.touchedDefaults.has("activationType")
          ? drafts.defaults.activationType
          : (currentPreview.defaults.activationType ?? ""),
        influencerType: drafts.touchedDefaults.has("influencerType")
          ? drafts.defaults.influencerType
          : (currentPreview.defaults.influencerType ?? ""),
        influencerVertical: drafts.touchedDefaults.has("influencerVertical")
          ? drafts.defaults.influencerVertical
          : (currentPreview.defaults.influencerVertical ?? ""),
        countryRegion: drafts.touchedDefaults.has("countryRegion")
          ? drafts.defaults.countryRegion
          : (currentPreview.defaults.countryRegion ?? ""),
        language: drafts.touchedDefaults.has("language")
          ? drafts.defaults.language
          : (currentPreview.defaults.language ?? ""),
      },
      rowOverrides,
      clearedFields,
    };

    setRequestState("saving");
    setRequestMessage("Saving edits...");

    try {
      const nextPreview = await updateHubspotExportPreview(currentPreview.run.id, payload);
      setCurrentPreview(nextPreview);
      setDrafts(createEmptyDrafts());
      setRequestState("idle");
      setRequestMessage("Edits saved.");
    } catch (error) {
      setRequestState("error");
      setRequestMessage(error instanceof Error ? error.message : "Unable to save edits.");
    }
  }

  async function handleGoogleSheetsExport() {
    setGoogleSheetsState("saving");
    setGoogleSheetsMessage("Exporting prepared rows to Google Sheets...");

    try {
      const result = await exportRunToGoogleSheets(currentPreview.run.id, googleSheetsRequest);
      const unmatchedMessage =
        result.unmatchedHeaders.length > 0
          ? ` ${result.unmatchedHeaders.length} sheet columns were left blank.`
          : "";

      setGoogleSheetsState("success");
      setGoogleSheetsMessage(
        `Imported ${result.appendedRowCount} rows into ${result.sheetName}. Matched ${result.matchedHeaderCount} columns.${unmatchedMessage}`,
      );
    } catch (error) {
      setGoogleSheetsState("error");
      setGoogleSheetsMessage(
        error instanceof Error ? error.message : "Unable to export this run to Google Sheets.",
      );
    }
  }

  return (
    <div className="export-prep">
      <section className="export-prep__defaults">
        <div className="database-records__header export-prep__defaults-header">
          <div>
            <h2>Run defaults</h2>
            <p className="workspace-copy">Set shared dropdown defaults, then review row-level overrides below.</p>
          </div>
          <button
            className="workspace-button export-prep__defaults-save"
            disabled={!hasPendingChanges || requestState === "saving"}
            onClick={() => void handleSave()}
            type="button"
          >
            {requestState === "saving" ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="export-prep__defaults-grid">
          {currentPreview.columns
            .filter((column) => {
              if (!column.dropdownFieldKey) {
                return false;
              }

              const fieldKey = column.key as keyof HubspotPrepUpdateDefaults;
              return (
                drafts.defaults[fieldKey] !== undefined &&
                RUN_DEFAULT_COLUMN_KEYS.has(fieldKey)
              );
            })
            .map((column) => {
              const fieldKey = column.key as keyof HubspotPrepUpdateDefaults;
              const currentValue = currentPreview.defaults[column.key] ?? "";
              const options: SearchableSelectOption[] = [
                {
                  value: "",
                  label: currentValue || `Select ${column.label}`,
                },
                ...currentPreview.dropdownOptions[column.dropdownFieldKey!].map((option) => ({
                  value: option,
                  label: option,
                })),
              ];
              return (
                <label className="new-scouting__field export-prep__default-field" key={column.key}>
                  <span>{column.label}</span>
                  <SearchableSelect
                    ariaLabel={column.label}
                    disabled={requestState === "saving"}
                    onChange={(value) => updateDefault(fieldKey, value)}
                    options={options}
                    placeholder={currentValue || `Select ${column.label}`}
                    searchPlaceholder={`Search ${column.label}...`}
                    value={drafts.defaults[fieldKey]}
                  />
                </label>
              );
            })}
        </div>
      </section>

      {requestMessage ? (
        <p
          className={`new-scouting__status new-scouting__status--${requestState}`}
          role={requestState === "error" ? "alert" : "status"}
        >
          {requestMessage}
        </p>
      ) : null}

      {validationIssues.length > 0 ? (
        <section className="workspace-callout workspace-callout--error">
          <h3>Missing required values</h3>
          <p>{validationIssues.length} requirements still need manual input before export.</p>
        </section>
      ) : null}

      <HubspotSyncPanel
        hasPendingChanges={hasPendingChanges}
        isSaving={requestState === "saving"}
        runId={currentPreview.run.id}
        validationIssueCount={validationIssues.length}
      />

      <section className="export-prep__defaults">
        <div className="database-records__header export-prep__defaults-header">
          <div>
            <h2>Google Sheets export</h2>
            <p className="workspace-copy">
              Append the prepared rows to an existing sheet tab using its first-row headers.
              Save any row edits first so the export uses the latest values.
            </p>
          </div>
          <button
            className="workspace-button export-prep__defaults-save"
            disabled={!canExportToGoogleSheets}
            onClick={() => void handleGoogleSheetsExport()}
            type="button"
          >
            {googleSheetsState === "saving" ? "Exporting..." : "Export to Google Sheets"}
          </button>
        </div>

        <div className="export-prep__defaults-grid">
          <label className="new-scouting__field export-prep__default-field">
            <span>Spreadsheet URL or ID</span>
            <input
              disabled={googleSheetsState === "saving"}
              onChange={(event) => {
                const { value } = event.currentTarget;

                setGoogleSheetsRequest((current) => ({
                  ...current,
                  spreadsheetIdOrUrl: value,
                }));
                setGoogleSheetsState("idle");
                setGoogleSheetsMessage("");
              }}
              placeholder="https://docs.google.com/spreadsheets/d/... or spreadsheet id"
              value={googleSheetsRequest.spreadsheetIdOrUrl}
            />
          </label>

          <label className="new-scouting__field export-prep__default-field">
            <span>Sheet name</span>
            <input
              disabled={googleSheetsState === "saving"}
              onChange={(event) => {
                const { value } = event.currentTarget;

                setGoogleSheetsRequest((current) => ({
                  ...current,
                  sheetName: value,
                }));
                setGoogleSheetsState("idle");
                setGoogleSheetsMessage("");
              }}
              placeholder="Sheet1"
              value={googleSheetsRequest.sheetName}
            />
          </label>
        </div>

        {googleSheetsBlockingMessage ? (
          <p className="workspace-copy" role="status">
            {googleSheetsBlockingMessage}
          </p>
        ) : null}

        {googleSheetsMessage ? (
          <p
            className={`new-scouting__status new-scouting__status--${
              googleSheetsState === "success" ? "idle" : googleSheetsState
            }`}
            role={googleSheetsState === "error" ? "alert" : "status"}
          >
            {googleSheetsMessage}
          </p>
        ) : null}
      </section>

      <div className="export-prep__actions">
        <button
          className="database-records__cta"
          disabled={!hasPendingChanges || requestState === "saving"}
          onClick={() => void handleSave()}
          type="button"
        >
          {requestState === "saving" ? "Saving..." : "Save"}
        </button>
      </div>

      <p className="workspace-copy">
        Fields marked * are required. Each row must also have at least one of First Name, Last
        Name, or Email (marked †).
      </p>

      <div className="export-prep__table-shell">
        <table className="export-prep__table">
          <thead>
            <tr>
              {currentPreview.columns.map((column) => (
                <th key={column.key}>
                  {column.label}
                  {column.required
                    ? " *"
                    : CONTACT_IDENTITY_FIELD_KEYS.has(column.key)
                      ? " †"
                      : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentPreview.rows.map((row) => (
              <tr key={row.id}>
                {currentPreview.columns.map((column) => {
                  const placeholderValue = row.values[column.key] ?? "";
                  const isMissingContactIdentity =
                    CONTACT_IDENTITY_FIELD_KEYS.has(column.key)
                    && validationIssues.some(
                      (issue) =>
                        issue.rowId === row.id
                        && issue.columnKey === HUBSPOT_CONTACT_IDENTITY_COLUMN_KEY,
                    );
                  const isMissingRequiredValue =
                    !placeholderValue.trim()
                    && (column.required || isMissingContactIdentity);

                  return (
                    <td key={column.key}>
                      {!column.editable ? (
                        <span className="export-prep__readonly">{placeholderValue}</span>
                      ) : column.fieldType === "dropdown" && column.dropdownFieldKey ? (
                        <div className="export-prep__cell-editor">
                          <SearchableSelect
                            ariaLabel={column.label}
                            disabled={requestState === "saving"}
                            onChange={(value) => updateRowValue(row.rowKey, column.key as HubspotPrepClearField["field"], value)}
                            options={buildRowDropdownOptions({
                              currentValue: placeholderValue,
                              label: column.label,
                              options: currentPreview.dropdownOptions[column.dropdownFieldKey],
                            })}
                            placeholder={placeholderValue || `Select ${column.label}`}
                            searchPlaceholder={`Search ${column.label}...`}
                            value={getDisplayRowValue({
                              drafts,
                              rowKey: row.rowKey,
                              field: column.key as HubspotPrepClearField["field"],
                              currentValue: placeholderValue,
                            })}
                          />
                        </div>
                      ) : (
                        <div className="export-prep__cell-editor">
                          <input
                            className={isMissingRequiredValue ? "export-prep__input export-prep__input--missing" : "export-prep__input"}
                            disabled={requestState === "saving"}
                            onChange={(event) =>
                              updateRowValue(
                                row.rowKey,
                                column.key as HubspotPrepClearField["field"],
                                event.currentTarget.value,
                              )
                            }
                            placeholder={placeholderValue ? "" : `Enter ${column.label}`}
                            value={getDisplayRowValue({
                              drafts,
                              rowKey: row.rowKey,
                              field: column.key as HubspotPrepClearField["field"],
                              currentValue: placeholderValue,
                            })}
                          />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
