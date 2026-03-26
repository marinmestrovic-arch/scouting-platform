"use client";

import type {
  CsvExportPreview,
  ExportPreviewColumn,
  ExportPreviewRow,
  HubspotExportPreview,
} from "@scouting-platform/contracts";
import React, { useMemo, useState } from "react";

type ExportPreparationWorkspaceProps = Readonly<{
  mode: "csv" | "hubspot";
  preview: CsvExportPreview | HubspotExportPreview;
}>;

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

export function ExportPreparationWorkspace({
  mode,
  preview,
}: ExportPreparationWorkspaceProps) {
  const [rows, setRows] = useState(preview.rows);
  const validationIssues = "validationIssues" in preview
    ? rows.flatMap((row) =>
        preview.requiredColumnKeys.flatMap((columnKey) =>
          row.values[columnKey]?.trim()
            ? []
            : [{ rowId: row.id, columnKey, message: `${columnKey} is required` }],
        ),
      )
    : [];

  const fileName = useMemo(() => {
    const suffix = mode === "hubspot" ? "hubspot-prep" : "csv-export";
    return `${preview.run.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}.csv`;
  }, [mode, preview.run.name]);

  return (
    <div className="export-prep">
      {"defaults" in preview ? (
        <section className="export-prep__defaults">
          <h2>Run defaults</h2>
          <div className="export-prep__defaults-grid">
            {Object.entries(preview.defaults).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {validationIssues.length > 0 ? (
        <section className="workspace-callout workspace-callout--error">
          <h3>Missing required values</h3>
          <p>{validationIssues.length} fields still need manual input before export.</p>
        </section>
      ) : null}

      <div className="export-prep__actions">
        <button
          onClick={() => downloadCsv(fileName, buildCsv(preview.columns, rows))}
          type="button"
        >
          Download {mode === "hubspot" ? "HubSpot" : "CSV"} file
        </button>
      </div>

      <div className="export-prep__table-shell">
        <table className="export-prep__table">
          <thead>
            <tr>
              {preview.columns.map((column) => (
                <th key={column.key}>
                  {column.label}
                  {column.required ? " *" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.id}>
                {preview.columns.map((column) => (
                  <td key={column.key}>
                    {column.editable ? (
                      <input
                        className={!row.values[column.key]?.trim() && column.required ? "export-prep__input export-prep__input--missing" : "export-prep__input"}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((currentRow, currentIndex) =>
                              currentIndex === rowIndex
                                ? {
                                    ...currentRow,
                                    values: {
                                      ...currentRow.values,
                                      [column.key]: event.currentTarget.value,
                                    },
                                  }
                                : currentRow,
                            ),
                          )
                        }
                        value={row.values[column.key] ?? ""}
                      />
                    ) : (
                      <span>{row.values[column.key] ?? ""}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
