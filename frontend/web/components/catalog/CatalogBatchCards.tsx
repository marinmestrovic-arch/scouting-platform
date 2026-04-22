import Link from "next/link";
import React from "react";

import {
  getCsvExportBatchResultHref,
  getHubspotPushBatchResultHref,
} from "../../lib/navigation";
import { getCsvExportBatchDownloadUrl } from "../../lib/csv-export-batches-api";
import { StatusPill } from "../ui/StatusPill";
import type {
  CatalogCsvExportBatchState,
  CatalogHubspotPushBatchState,
} from "./catalog-table-shared";
import {
  getCatalogBatchStatusLabel,
  getCsvExportBatchSnapshot,
  getCsvExportBatchSummaryCopy,
  getCsvExportBatchTimestamp,
  getFailedHubspotPushRows,
  getHubspotPushBatchSnapshot,
  getHubspotPushBatchSummaryCopy,
  getHubspotPushBatchTimestamp,
  getHubspotPushFailedRowLabel,
} from "./catalog-table-shared";

function isRecent(timestamp: string | null): boolean {
  if (!timestamp) {
    return false;
  }

  const parsed = Date.parse(timestamp);

  if (!Number.isFinite(parsed)) {
    return false;
  }

  return Date.now() - parsed <= 60 * 60 * 1000;
}

type CatalogBatchCardsProps = Readonly<{
  latestCsvExportBatch: CatalogCsvExportBatchState;
  latestHubspotPushBatch: CatalogHubspotPushBatchState;
}>;

export function CatalogBatchCards({
  latestCsvExportBatch,
  latestHubspotPushBatch,
}: CatalogBatchCardsProps) {
  const csvExportBatch = getCsvExportBatchSnapshot(latestCsvExportBatch);
  const hubspotPushBatch = getHubspotPushBatchSnapshot(latestHubspotPushBatch);
  const failedHubspotRows = getFailedHubspotPushRows(latestHubspotPushBatch).slice(0, 3);
  const batchCount = Number(latestCsvExportBatch.requestState !== "idle") + Number(latestHubspotPushBatch.requestState !== "idle");

  if (batchCount === 0) {
    return (
      <details className="catalog-table__batch-section">
        <summary className="catalog-table__batch-summary">Recent exports (0)</summary>
      </details>
    );
  }

  const isOpen =
    latestCsvExportBatch.requestState === "loading" ||
    latestHubspotPushBatch.requestState === "loading" ||
    csvExportBatch?.status === "queued" ||
    csvExportBatch?.status === "running" ||
    hubspotPushBatch?.status === "queued" ||
    hubspotPushBatch?.status === "running" ||
    isRecent(csvExportBatch?.updatedAt ?? null) ||
    isRecent(hubspotPushBatch?.updatedAt ?? null);

  return (
    <details className="catalog-table__batch-section" open={isOpen}>
      <summary className="catalog-table__batch-summary">Recent exports ({batchCount})</summary>
      <div className="catalog-table__batch-grid">
        {latestCsvExportBatch.requestState !== "idle" ? (
          <article className="catalog-table__batch-card" aria-labelledby="catalog-latest-export-heading">
            <header className="catalog-table__batch-card-header">
              <div>
                <p className="catalog-table__batch-eyebrow">Latest batch</p>
                <h3 id="catalog-latest-export-heading">CSV export</h3>
              </div>
              {csvExportBatch ? (
                <StatusPill status={csvExportBatch.status} />
              ) : (
                <span className="status-pill status-pill--neutral">{getCatalogBatchStatusLabel("loading")}</span>
              )}
            </header>

            <p className="catalog-table__batch-copy">{getCsvExportBatchSummaryCopy(latestCsvExportBatch)}</p>

            {latestCsvExportBatch.isRefreshing ? (
              <p className="catalog-table__batch-inline-note" role="status">
                Refreshing export status...
              </p>
            ) : null}

            {latestCsvExportBatch.error && csvExportBatch ? (
              <p className="catalog-table__batch-error" role="alert">
                Last refresh failed: {latestCsvExportBatch.error}
              </p>
            ) : null}

            {csvExportBatch ? (
              <>
                <dl className="catalog-table__batch-meta">
                  <div>
                    <dt>File</dt>
                    <dd>{csvExportBatch.fileName}</dd>
                  </div>
                  <div>
                    <dt>Rows</dt>
                    <dd>{csvExportBatch.rowCount}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{getCsvExportBatchTimestamp(latestCsvExportBatch) ?? "Not available"}</dd>
                  </div>
                </dl>

                <div className="catalog-table__batch-actions">
                  {csvExportBatch.status === "completed" ? (
                    <a
                      className="catalog-table__button catalog-table__button--secondary"
                      download
                      href={getCsvExportBatchDownloadUrl(csvExportBatch.id)}
                    >
                      Download CSV
                    </a>
                  ) : null}
                  <Link
                    className="catalog-table__button catalog-table__button--secondary"
                    href={getCsvExportBatchResultHref(csvExportBatch.id)}
                  >
                    Open batch result
                  </Link>
                </div>
              </>
            ) : null}
          </article>
        ) : null}

        {latestHubspotPushBatch.requestState !== "idle" ? (
          <article className="catalog-table__batch-card" aria-labelledby="catalog-latest-hubspot-heading">
            <header className="catalog-table__batch-card-header">
              <div>
                <p className="catalog-table__batch-eyebrow">Latest batch</p>
                <h3 id="catalog-latest-hubspot-heading">HubSpot push</h3>
              </div>
              {hubspotPushBatch ? (
                <StatusPill status={hubspotPushBatch.status} />
              ) : (
                <span className="status-pill status-pill--neutral">{getCatalogBatchStatusLabel("loading")}</span>
              )}
            </header>

            <p className="catalog-table__batch-copy">{getHubspotPushBatchSummaryCopy(latestHubspotPushBatch)}</p>

            {latestHubspotPushBatch.isRefreshing ? (
              <p className="catalog-table__batch-inline-note" role="status">
                Refreshing HubSpot status...
              </p>
            ) : null}

            {latestHubspotPushBatch.error && hubspotPushBatch ? (
              <p className="catalog-table__batch-error" role="alert">
                Last refresh failed: {latestHubspotPushBatch.error}
              </p>
            ) : null}

            {hubspotPushBatch ? (
              <>
                <dl className="catalog-table__batch-meta">
                  <div>
                    <dt>Total</dt>
                    <dd>{hubspotPushBatch.totalRowCount}</dd>
                  </div>
                  <div>
                    <dt>Pushed</dt>
                    <dd>{hubspotPushBatch.pushedRowCount}</dd>
                  </div>
                  <div>
                    <dt>Failed</dt>
                    <dd>{hubspotPushBatch.failedRowCount}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{getHubspotPushBatchTimestamp(latestHubspotPushBatch) ?? "Not available"}</dd>
                  </div>
                </dl>

                {failedHubspotRows.length > 0 ? (
                  <div className="catalog-table__batch-failures">
                    <h4>Failed rows</h4>
                    <ul className="catalog-table__batch-failure-list">
                      {failedHubspotRows.map((row) => (
                        <li key={row.id}>{getHubspotPushFailedRowLabel(row)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="catalog-table__batch-actions">
              <Link
                className="catalog-table__button catalog-table__button--secondary"
                href={hubspotPushBatch ? getHubspotPushBatchResultHref(hubspotPushBatch.id) : "/hubspot"}
              >
                Open batch result
              </Link>
            </div>
          </article>
        ) : null}
      </div>
    </details>
  );
}
