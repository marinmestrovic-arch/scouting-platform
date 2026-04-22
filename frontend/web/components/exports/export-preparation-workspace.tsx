"use client";

import type {
  CsvExportPreview,
  ExportPreviewColumn,
  ExportPreviewRow,
  ExportRunToGoogleSheetsRequest,
  HubspotPrepClearField,
  HubspotPrepUpdateDefaults,
  HubspotPrepRowOverrideValues,
  HubspotPrepUpdateRequest,
  HubspotExportPreview,
} from "@scouting-platform/contracts";
import React, { useMemo, useState } from "react";

import {
  enrichHubspotExportPreview,
  updateHubspotExportPreview,
} from "../../lib/export-previews-api";
import { exportRunToGoogleSheets } from "../../lib/google-sheets-export-api";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";

type ExportPreparationWorkspaceProps = Readonly<{
  mode: "csv" | "hubspot";
  preview: CsvExportPreview | HubspotExportPreview;
}>;

const RUN_DEFAULT_COLUMN_KEYS = new Set<keyof HubspotPrepUpdateDefaults>([
  "currency",
  "dealType",
  "activationType",
]);

type HubspotDrafts = {
  defaults: HubspotPrepUpdateDefaults;
  touchedDefaults: Set<keyof HubspotPrepUpdateDefaults>;
  rowValues: Record<string, Record<string, string>>;
  touchedRowFields: Record<string, Set<HubspotPrepClearField["field"]>>;
};

type CreatorListEnrichmentProgressState = {
  open: boolean;
  percentage: number;
  message: string;
  status: "idle" | "saving" | "success" | "error";
};

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll(`"`, `""`)}"`;
}

function buildCsv(columns: ExportPreviewColumn[], rows: ExportPreviewRow[]): string {
  const header = columns.map((column) => column.label).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvCell(row.values[column.key] ?? "")).join(","),
  );

  return [header, ...body].join("\n");
}

function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function isHubspotPreview(
  preview: CsvExportPreview | HubspotExportPreview,
): preview is HubspotExportPreview {
  return "dropdownOptions" in preview;
}

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

function createEmptyCreatorListEnrichmentProgressState(): CreatorListEnrichmentProgressState {
  return {
    open: false,
    percentage: 0,
    message: "",
    status: "idle",
  };
}

function getCreatorListEnrichmentBlockingMessage(input: {
  hasPendingChanges: boolean;
}): string | null {
  if (input.hasPendingChanges) {
    return "Save HubSpot preparation before starting Creator List enrichment.";
  }

  return null;
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
  mode,
  preview,
}: ExportPreparationWorkspaceProps) {
  const [currentPreview, setCurrentPreview] = useState(preview);
  const [drafts, setDrafts] = useState<HubspotDrafts>(
    isHubspotPreview(preview)
      ? createEmptyDrafts()
      : {
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
        },
  );
  const [requestState, setRequestState] = useState<"idle" | "saving" | "error">("idle");
  const [requestMessage, setRequestMessage] = useState("");
  const [googleSheetsRequest, setGoogleSheetsRequest] = useState<ExportRunToGoogleSheetsRequest>(
    createEmptyGoogleSheetsRequest(),
  );
  const [googleSheetsState, setGoogleSheetsState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [googleSheetsMessage, setGoogleSheetsMessage] = useState("");
  const [creatorListEnrichmentState, setCreatorListEnrichmentState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [creatorListEnrichmentMessage, setCreatorListEnrichmentMessage] = useState("");
  const [creatorListEnrichmentProgress, setCreatorListEnrichmentProgress] =
    useState<CreatorListEnrichmentProgressState>(
      createEmptyCreatorListEnrichmentProgressState(),
    );
  const fileName = useMemo(() => {
    const suffix = mode === "hubspot" ? "hubspot-prep" : "csv-export";
    return `${currentPreview.run.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}.csv`;
  }, [currentPreview.run.name, mode]);
  const validationIssues = isHubspotPreview(currentPreview) ? currentPreview.validationIssues : [];
  const hasPendingChanges =
    isHubspotPreview(currentPreview) &&
    (Object.values(drafts.touchedRowFields).some((fields) => fields.size > 0) ||
      drafts.touchedDefaults.size > 0);
  const canExportToGoogleSheets =
    googleSheetsRequest.spreadsheetIdOrUrl.trim().length > 0 &&
    googleSheetsRequest.sheetName.trim().length > 0 &&
    googleSheetsState !== "saving" &&
    creatorListEnrichmentState !== "saving" &&
    requestState !== "saving" &&
    !hasPendingChanges;
  const canEnrichCreatorList =
    googleSheetsState !== "saving" &&
    creatorListEnrichmentState !== "saving" &&
    requestState !== "saving";

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
    if (!isHubspotPreview(currentPreview)) {
      return;
    }

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
    setRequestMessage("Saving HubSpot preparation...");

    try {
      const nextPreview = await updateHubspotExportPreview(currentPreview.run.id, payload);
      setCurrentPreview(nextPreview);
      setDrafts(createEmptyDrafts());
      setRequestState("idle");
      setRequestMessage("HubSpot preparation saved.");
    } catch (error) {
      setRequestState("error");
      setRequestMessage(error instanceof Error ? error.message : "Unable to save HubSpot preparation.");
    }
  }

  async function handleGoogleSheetsExport() {
    if (!isHubspotPreview(currentPreview)) {
      return;
    }

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

  async function handleCreatorListEnrichment() {
    if (!isHubspotPreview(currentPreview)) {
      return;
    }

    const blockingMessage = getCreatorListEnrichmentBlockingMessage({
      hasPendingChanges,
    });

    if (blockingMessage) {
      setCreatorListEnrichmentState("error");
      setCreatorListEnrichmentMessage(blockingMessage);
      setCreatorListEnrichmentProgress({
        open: true,
        percentage: 0,
        message: blockingMessage,
        status: "error",
      });
      return;
    }

    setCreatorListEnrichmentState("saving");
    setCreatorListEnrichmentMessage("Enriching Creator List rows in the workspace...");
    setCreatorListEnrichmentProgress({
      open: true,
      percentage: 2,
      message: "Starting Creator List enrichment...",
      status: "saving",
    });

    try {
      const result = await enrichHubspotExportPreview(currentPreview.run.id, {
        onProgress(progress) {
          setCreatorListEnrichmentProgress({
            open: true,
            percentage: progress.percentage,
            message: progress.message,
            status: "saving",
          });
        },
      });

      const successMessage =
        result.updatedFieldCount > 0
          ? `Enriched ${result.updatedRowCount} row${result.updatedRowCount === 1 ? "" : "s"} in the workspace. Filled ${result.updatedFieldCount} field${result.updatedFieldCount === 1 ? "" : "s"} across ${result.processedChannelCount} refreshed channel${result.processedChannelCount === 1 ? "" : "s"}${result.failedChannelCount > 0 ? `. ${result.failedChannelCount} channel${result.failedChannelCount === 1 ? "" : "s"} could not be refreshed.` : "."}`
          : result.failedChannelCount > 0
            ? `Creator List enrichment finished, but ${result.failedChannelCount} channel${result.failedChannelCount === 1 ? "" : "s"} could not be refreshed and no additional fields were filled.`
            : "Creator List enrichment finished. No additional fields were filled.";

      setCurrentPreview(result.preview);
      setDrafts(createEmptyDrafts());
      setCreatorListEnrichmentState("success");
      setCreatorListEnrichmentMessage(successMessage);
      setCreatorListEnrichmentProgress({
        open: true,
        percentage: 100,
        message: successMessage,
        status: "success",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to enrich this creator list in the workspace.";

      setCreatorListEnrichmentState("error");
      setCreatorListEnrichmentMessage(errorMessage);
      setCreatorListEnrichmentProgress((current) => ({
        open: true,
        percentage: current.percentage,
        message: errorMessage,
        status: "error",
      }));
    }
  }

  return (
    <div className="export-prep">
      {isHubspotPreview(currentPreview) ? (
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
      ) : null}

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
          <p>{validationIssues.length} fields still need manual input before export.</p>
        </section>
      ) : null}

      {isHubspotPreview(currentPreview) ? (
        <section className="export-prep__defaults">
          <div className="database-records__header export-prep__defaults-header">
            <div>
              <h2>Google Sheets export</h2>
              <p className="workspace-copy">
                Append these prepared HubSpot rows to an existing sheet tab using its first-row
                headers. Save any row edits first so the export uses the latest prepared values.
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
                disabled={
                  googleSheetsState === "saving" || creatorListEnrichmentState === "saving"
                }
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
                disabled={
                  googleSheetsState === "saving" || creatorListEnrichmentState === "saving"
                }
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
      ) : null}

      {creatorListEnrichmentMessage ? (
        <p
          className={`new-scouting__status new-scouting__status--${
            creatorListEnrichmentState === "success" ? "idle" : creatorListEnrichmentState
          }`}
          role={creatorListEnrichmentState === "error" ? "alert" : "status"}
        >
          {creatorListEnrichmentMessage}
        </p>
      ) : null}

      <div className="export-prep__actions">
        {mode === "csv" ? (
          <button
            className="workspace-button workspace-button--secondary"
            onClick={() => downloadCsv(fileName, buildCsv(currentPreview.columns, currentPreview.rows))}
            type="button"
          >
            Download CSV file
          </button>
        ) : (
          <button
            className="workspace-button workspace-button--secondary"
            disabled={!canEnrichCreatorList}
            onClick={() => void handleCreatorListEnrichment()}
            type="button"
          >
            {creatorListEnrichmentState === "saving" ? "Enriching..." : "Enrich Creator List"}
          </button>
        )}
        {isHubspotPreview(currentPreview) ? (
          <button
            className="database-records__cta"
            disabled={!hasPendingChanges || requestState === "saving"}
            onClick={() => void handleSave()}
            type="button"
          >
            {requestState === "saving" ? "Saving..." : "Save"}
          </button>
        ) : null}
      </div>

      <div className="export-prep__table-shell">
        <table className="export-prep__table">
          <thead>
            <tr>
              {currentPreview.columns.map((column) => (
                <th key={column.key}>
                  {column.label}
                  {column.required ? " *" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentPreview.rows.map((row) => (
              <tr key={row.id}>
                {currentPreview.columns.map((column) => {
                  const placeholderValue = row.values[column.key] ?? "";

                  return (
                    <td key={column.key}>
                      {!column.editable ? (
                        <span className="export-prep__readonly">{placeholderValue}</span>
                      ) : isHubspotPreview(currentPreview) && column.fieldType === "dropdown" && column.dropdownFieldKey ? (
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
                            className={!placeholderValue.trim() && column.required ? "export-prep__input export-prep__input--missing" : "export-prep__input"}
                            disabled={requestState === "saving"}
                            onChange={(event) =>
                              updateRowValue(
                                row.rowKey,
                                column.key as HubspotPrepClearField["field"],
                                event.currentTarget.value,
                              )
                            }
                            placeholder={placeholderValue ? "" : `Enter ${column.label}`}
                            value={
                              isHubspotPreview(currentPreview)
                                ? getDisplayRowValue({
                                    drafts,
                                    rowKey: row.rowKey,
                                    field: column.key as HubspotPrepClearField["field"],
                                    currentValue: placeholderValue,
                                  })
                                : (row.values[column.key] ?? "")
                            }
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

      {creatorListEnrichmentProgress.open ? (
        <div
          className="database-admin__modal-backdrop"
          onClick={() => {
            if (creatorListEnrichmentProgress.status === "saving") {
              return;
            }

            setCreatorListEnrichmentProgress(createEmptyCreatorListEnrichmentProgressState());
          }}
          role="presentation"
        >
          <section
            aria-labelledby="creator-list-enrichment-progress-title"
            aria-modal="true"
            className="database-admin__modal export-prep__progress-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="database-admin__modal-header">
              <div>
                <h3 id="creator-list-enrichment-progress-title">Creator List Enrichment</h3>
                <p className="workspace-copy">
                  Keep this window open while the workspace enrichment runs.
                </p>
              </div>
              <button
                className="database-admin__modal-close"
                disabled={creatorListEnrichmentProgress.status === "saving"}
                onClick={() =>
                  setCreatorListEnrichmentProgress(
                    createEmptyCreatorListEnrichmentProgressState(),
                  )
                }
                type="button"
              >
                {creatorListEnrichmentProgress.status === "saving" ? "Running..." : "Close"}
              </button>
            </div>

            <div className="export-prep__progress-meta" aria-live="polite">
              <span className="export-prep__progress-percent">
                {Math.min(100, Math.max(0, creatorListEnrichmentProgress.percentage))}%
              </span>
              <p className="export-prep__progress-message">
                {creatorListEnrichmentProgress.message}
              </p>
            </div>

            <div
              aria-hidden="true"
              className="export-prep__progress-track"
            >
              <span
                className="export-prep__progress-fill"
                style={{
                  width: `${Math.min(100, Math.max(0, creatorListEnrichmentProgress.percentage))}%`,
                }}
              />
            </div>

            <p className="export-prep__progress-copy">
              {creatorListEnrichmentProgress.status === "saving"
                ? "Enrichment is running."
                : creatorListEnrichmentProgress.status === "error"
                  ? "Enrichment stopped before completion."
                  : "Enrichment finished."}
            </p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
