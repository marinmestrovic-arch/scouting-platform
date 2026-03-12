"use client";

import type {
  CsvImportBatchDetail,
  CsvImportBatchStatus,
  CsvImportBatchSummary,
} from "@scouting-platform/contracts";
import {
  CSV_IMPORT_FILE_SIZE_LIMIT_BYTES,
  CSV_IMPORT_HEADER,
  CSV_IMPORT_MAX_DATA_ROWS,
  CSV_IMPORT_TEMPLATE_VERSION,
} from "@scouting-platform/contracts";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import {
  AdminCsvImportsApiError,
  createAdminCsvImportBatch,
  fetchAdminCsvImportBatchDetail,
  fetchAdminCsvImportBatches,
} from "../../lib/admin-csv-imports-api";

type AdminCsvImportListState = {
  status: "loading" | "error" | "ready";
  items: CsvImportBatchSummary[];
  error: string | null;
};

type AdminCsvImportDetailState = {
  status: "idle" | "loading" | "error" | "ready";
  data: CsvImportBatchDetail | null;
  error: string | null;
};

type AdminCsvImportUploadState = {
  type: "idle" | "submitting" | "success" | "error";
  message: string;
};

type AdminCsvImportManagerViewProps = Readonly<{
  fileInputResetToken: number;
  selectedFileName: string;
  uploadState: AdminCsvImportUploadState;
  listState: AdminCsvImportListState;
  detailState: AdminCsvImportDetailState;
  selectedBatchId: string | null;
  isRefreshingList: boolean;
  isRefreshingDetail: boolean;
  onFileChange: (file: File | null) => void;
  onUpload: () => void | Promise<void>;
  onReload: () => void;
  onRetryList: () => void;
  onRetryDetail: () => void;
  onSelectBatch: (batchId: string) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}>;

const ACTIVE_POLLING_STATUSES = new Set<CsvImportBatchStatus>(["queued", "running"]);
const CSV_IMPORT_HEADER_LINE = CSV_IMPORT_HEADER.join(",");
const INITIAL_LIST_STATE: AdminCsvImportListState = {
  status: "loading",
  items: [],
  error: null,
};
const INITIAL_DETAIL_STATE: AdminCsvImportDetailState = {
  status: "idle",
  data: null,
  error: null,
};
const IDLE_UPLOAD_STATE: AdminCsvImportUploadState = {
  type: "idle",
  message: "",
};

export const ADMIN_CSV_IMPORT_POLL_INTERVAL_MS = 3000;

function normalizeErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not available";
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);

  if (!match) {
    return value;
  }

  return `${match[1]} ${match[2]} UTC`;
}

function toTitleCase(value: string): string {
  return value
    .split("_")
    .map((segment) => {
      if (!segment) {
        return segment;
      }

      return `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`;
    })
    .join(" ");
}

function formatNullableCell(value: string | null): string {
  return value?.trim() || "Not provided";
}

function formatMetricSummary(batch: Pick<CsvImportBatchSummary, "importedRowCount" | "failedRowCount" | "totalRowCount">): string {
  return `${batch.importedRowCount} imported · ${batch.failedRowCount} failed · ${batch.totalRowCount} total`;
}

function formatRowMetrics(row: CsvImportBatchDetail["rows"][number]): string {
  const segments = [
    row.subscriberCount ? `Subs ${row.subscriberCount}` : null,
    row.viewCount ? `Views ${row.viewCount}` : null,
    row.videoCount ? `Videos ${row.videoCount}` : null,
  ].filter((segment): segment is string => Boolean(segment));

  return segments.join(" · ") || "No metrics supplied";
}

function getBatchPageSummary(batch: CsvImportBatchDetail): string {
  const startRow = batch.totalRowCount === 0 ? 0 : (batch.page - 1) * batch.pageSize + 1;
  const endRow = batch.totalRowCount === 0 ? 0 : startRow + batch.rows.length - 1;
  const totalPages = Math.max(1, Math.ceil(batch.totalRowCount / batch.pageSize));

  return `Page ${batch.page} of ${totalPages}. Showing rows ${startRow}-${endRow} of ${batch.totalRowCount}.`;
}

export function getAdminCsvImportStatusLabel(status: CsvImportBatchStatus): string {
  return toTitleCase(status);
}

function getAdminCsvImportListSnippet(batch: CsvImportBatchSummary): string {
  if (batch.lastError) {
    return `Last error: ${batch.lastError}`;
  }

  if (batch.status === "queued" || batch.status === "running") {
    return "Background processing is in progress.";
  }

  if (batch.failedRowCount > 0) {
    return `${batch.failedRowCount} row${batch.failedRowCount === 1 ? "" : "s"} failed validation or import.`;
  }

  return "No row failures recorded.";
}

function getUploadErrorMessage(error: unknown): string {
  if (error instanceof AdminCsvImportsApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow CSV import uploads anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to upload the CSV import. Please try again.");
}

function getListErrorMessage(error: unknown): string {
  if (error instanceof AdminCsvImportsApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow CSV import review anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to load CSV import batches. Please try again.");
}

function getDetailErrorMessage(error: unknown): string {
  if (error instanceof AdminCsvImportsApiError && (error.status === 401 || error.status === 403)) {
    return "Your session does not allow CSV batch detail review anymore. Sign in again and retry.";
  }

  return normalizeErrorMessage(error, "Unable to load CSV import batch details. Please try again.");
}

function getUploadSuccessMessage(batch: CsvImportBatchSummary): string {
  if (batch.status === "completed") {
    return "Import batch created. Review the row results below.";
  }

  return "CSV import queued. Row results refresh automatically while processing continues.";
}

function resolveNextSelectedBatchId(
  currentBatchId: string | null,
  items: readonly CsvImportBatchSummary[],
): string | null {
  if (items.length === 0) {
    return null;
  }

  if (currentBatchId && items.some((item) => item.id === currentBatchId)) {
    return currentBatchId;
  }

  return items[0]?.id ?? null;
}

function isCsvFileName(fileName: string): boolean {
  return fileName.trim().toLowerCase().endsWith(".csv");
}

function getCsvImportUploadValidationError(file: File | null): string | null {
  if (!file) {
    return "Choose a CSV file to import.";
  }

  if (!isCsvFileName(file.name)) {
    return "File name must end with .csv";
  }

  if (file.size > CSV_IMPORT_FILE_SIZE_LIMIT_BYTES) {
    return "CSV file exceeds the 5 MiB limit";
  }

  return null;
}

export function shouldPollAdminCsvImportList(
  items: readonly Pick<CsvImportBatchSummary, "status">[],
): boolean {
  return items.some((item) => ACTIVE_POLLING_STATUSES.has(item.status));
}

export function shouldPollAdminCsvImportDetail(
  batch: Pick<CsvImportBatchDetail, "status"> | null,
): boolean {
  if (!batch) {
    return false;
  }

  return ACTIVE_POLLING_STATUSES.has(batch.status);
}

function renderDetailState(props: AdminCsvImportManagerViewProps): ReactElement {
  const { detailState, isRefreshingDetail } = props;

  if (detailState.status === "idle") {
    return (
      <div className="admin-csv-imports__empty-state">
        <h2>Select an import batch</h2>
        <p>Pick a batch from recent imports to review row-level outcomes, failures, and timestamps.</p>
      </div>
    );
  }

  if (detailState.status === "loading") {
    return (
      <div className="admin-csv-imports__feedback admin-csv-imports__feedback--loading">
        <p>Loading import batch details...</p>
      </div>
    );
  }

  if (detailState.status === "error" || !detailState.data) {
    return (
      <div className="admin-csv-imports__feedback admin-csv-imports__feedback--error" role="alert">
        <p>{detailState.error ?? "Unable to load CSV import batch details."}</p>
        <button
          className="admin-csv-imports__button admin-csv-imports__button--secondary"
          onClick={props.onRetryDetail}
          type="button"
        >
          Retry detail
        </button>
      </div>
    );
  }

  const batch = detailState.data;
  const hasPreviousPage = batch.page > 1;
  const hasNextPage = batch.page * batch.pageSize < batch.totalRowCount;

  return (
    <div className="admin-csv-imports__detail-stack">
      <header className="admin-csv-imports__detail-header">
        <div>
          <p className="admin-csv-imports__eyebrow">Selected batch</p>
          <h2>{batch.fileName}</h2>
          <p className="admin-csv-imports__detail-meta">
            <code>{batch.id}</code>
          </p>
        </div>
        <span className={`admin-csv-imports__status admin-csv-imports__status--${batch.status}`}>
          {getAdminCsvImportStatusLabel(batch.status)}
        </span>
      </header>

      {isRefreshingDetail ? (
        <p className="admin-csv-imports__inline-note" role="status">
          Refreshing selected batch...
        </p>
      ) : null}

      <div className="admin-csv-imports__callout">
        <h3>Row summary</h3>
        <p>{formatMetricSummary(batch)}</p>
      </div>

      <dl className="admin-csv-imports__details">
        <div>
          <dt>Requested by</dt>
          <dd>{batch.requestedBy.email}</dd>
        </div>
        <div>
          <dt>Template</dt>
          <dd>{batch.templateVersion}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatTimestamp(batch.createdAt)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatTimestamp(batch.startedAt)}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{formatTimestamp(batch.completedAt)}</dd>
        </div>
        <div>
          <dt>Last error</dt>
          <dd>{batch.lastError ?? "No batch-level worker error recorded."}</dd>
        </div>
      </dl>

      <div className="admin-csv-imports__pagination">
        <p className="admin-csv-imports__panel-copy">{getBatchPageSummary(batch)}</p>
        <div className="admin-csv-imports__actions">
          <button
            className="admin-csv-imports__button admin-csv-imports__button--secondary"
            disabled={!hasPreviousPage}
            onClick={props.onPreviousPage}
            type="button"
          >
            Previous page
          </button>
          <button
            className="admin-csv-imports__button admin-csv-imports__button--secondary"
            disabled={!hasNextPage}
            onClick={props.onNextPage}
            type="button"
          >
            Next page
          </button>
        </div>
      </div>

      {batch.rows.length === 0 ? (
        <div className="admin-csv-imports__empty-state">
          <h3>No rows on this page</h3>
          <p>This page has no stored row data. Move to another page when more rows exist.</p>
        </div>
      ) : (
        <div className="admin-csv-imports__table-wrap">
          <table className="admin-csv-imports__table">
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Status</th>
                <th scope="col">Channel</th>
                <th scope="col">Contact</th>
                <th scope="col">Metrics</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {batch.rows.map((row) => {
                const resultCopy = row.errorMessage
                  ? row.errorMessage
                  : row.channelId
                    ? `Imported into catalog as ${row.channelId}.`
                    : "Imported into catalog.";

                return (
                  <tr
                    className={
                      row.status === "failed"
                        ? "admin-csv-imports__table-row admin-csv-imports__table-row--failed"
                        : "admin-csv-imports__table-row"
                    }
                    key={row.id}
                  >
                    <td>{row.rowNumber}</td>
                    <td>
                      <span
                        className={`admin-csv-imports__status admin-csv-imports__status--${row.status}`}
                      >
                        {toTitleCase(row.status)}
                      </span>
                    </td>
                    <td>
                      <strong>{row.channelTitle}</strong>
                      <div className="admin-csv-imports__cell-copy">
                        <code>{row.youtubeChannelId}</code>
                      </div>
                      {(row.notes || row.sourceLabel) ? (
                        <div className="admin-csv-imports__cell-copy">
                          {row.notes ? row.notes : "No notes"}
                          {row.sourceLabel ? ` · ${row.sourceLabel}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td>{formatNullableCell(row.contactEmail)}</td>
                    <td>{formatRowMetrics(row)}</td>
                    <td>{resultCopy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AdminCsvImportManagerView(props: AdminCsvImportManagerViewProps): ReactElement {
  function handleUploadSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void props.onUpload();
  }

  return (
    <div className="admin-csv-imports">
      <div className="admin-csv-imports__toolbar">
        <div className="admin-csv-imports__toolbar-links">
          <Link className="admin-csv-imports__link" href="/admin">
            Approval queue
          </Link>
          <Link className="admin-csv-imports__link" href="/admin/users">
            User management
          </Link>
        </div>

        <div className="admin-csv-imports__toolbar-copy">
          <button
            className="admin-csv-imports__button admin-csv-imports__button--secondary"
            onClick={props.onReload}
            type="button"
          >
            Reload imports
          </button>
          {props.isRefreshingList ? (
            <p className="admin-csv-imports__inline-note" role="status">
              Refreshing imports...
            </p>
          ) : null}
        </div>
      </div>

      <div className="admin-csv-imports__layout">
        <div className="admin-csv-imports__sidebar">
          <section className="admin-csv-imports__panel" aria-labelledby="admin-csv-imports-upload-heading">
            <header className="admin-csv-imports__panel-header">
              <h2 id="admin-csv-imports-upload-heading">Upload CSV</h2>
              <p>Use the strict template only. The backend remains the sole import mutation path.</p>
            </header>

            <div className="admin-csv-imports__template-copy">
              <p>
                Template version <strong>{CSV_IMPORT_TEMPLATE_VERSION}</strong>. Header must exactly
                match:
              </p>
              <code>{CSV_IMPORT_HEADER_LINE}</code>
              <p>Maximum file size 5 MiB. Up to {CSV_IMPORT_MAX_DATA_ROWS} data rows per batch.</p>
            </div>

            <form className="admin-csv-imports__upload-form" onSubmit={handleUploadSubmit}>
              <label className="admin-csv-imports__field">
                <span>CSV file</span>
                <input
                  accept=".csv,text/csv"
                  key={props.fileInputResetToken}
                  onChange={(event) => {
                    props.onFileChange(event.currentTarget.files?.[0] ?? null);
                  }}
                  type="file"
                />
              </label>

              {props.selectedFileName ? (
                <p className="admin-csv-imports__panel-copy">Selected file: {props.selectedFileName}</p>
              ) : null}

              <button
                className="admin-csv-imports__button"
                disabled={props.uploadState.type === "submitting"}
                type="submit"
              >
                {props.uploadState.type === "submitting" ? "Uploading..." : "Upload batch"}
              </button>

              <p
                className={`admin-csv-imports__upload-status admin-csv-imports__upload-status--${props.uploadState.type}`}
                role={props.uploadState.type === "error" ? "alert" : "status"}
              >
                {props.uploadState.message}
              </p>
            </form>
          </section>

          <section className="admin-csv-imports__panel" aria-labelledby="admin-csv-imports-list-heading">
            <header className="admin-csv-imports__panel-header">
              <h2 id="admin-csv-imports-list-heading">Recent imports</h2>
              <p>Newest batches appear first and keep row failure counts visible.</p>
            </header>

            {props.listState.status === "loading" ? (
              <div className="admin-csv-imports__feedback admin-csv-imports__feedback--loading">
                <p>Loading CSV import batches...</p>
              </div>
            ) : null}

            {props.listState.status === "error" ? (
              <div className="admin-csv-imports__feedback admin-csv-imports__feedback--error" role="alert">
                <p>{props.listState.error ?? "Unable to load CSV import batches."}</p>
                <button
                  className="admin-csv-imports__button admin-csv-imports__button--secondary"
                  onClick={props.onRetryList}
                  type="button"
                >
                  Retry imports
                </button>
              </div>
            ) : null}

            {props.listState.status === "ready" && props.listState.items.length === 0 ? (
              <div className="admin-csv-imports__empty-state">
                <h3>No imports yet</h3>
                <p>Upload the first strict-template CSV batch to start building import history.</p>
              </div>
            ) : null}

            {props.listState.status === "ready" && props.listState.items.length > 0 ? (
              <ul className="admin-csv-imports__list">
                {props.listState.items.map((batch) => {
                  const isSelected = batch.id === props.selectedBatchId;

                  return (
                    <li key={batch.id}>
                      <button
                        className={`admin-csv-imports__list-item${
                          isSelected ? " admin-csv-imports__list-item--selected" : ""
                        }`}
                        onClick={() => {
                          props.onSelectBatch(batch.id);
                        }}
                        type="button"
                      >
                        <div className="admin-csv-imports__list-item-header">
                          <div>
                            <h3>{batch.fileName}</h3>
                            <p className="admin-csv-imports__panel-copy">
                              Created {formatTimestamp(batch.createdAt)}
                            </p>
                          </div>
                          <span className={`admin-csv-imports__status admin-csv-imports__status--${batch.status}`}>
                            {getAdminCsvImportStatusLabel(batch.status)}
                          </span>
                        </div>
                        <p className="admin-csv-imports__list-copy">{formatMetricSummary(batch)}</p>
                        <p className="admin-csv-imports__list-copy">{getAdminCsvImportListSnippet(batch)}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        </div>

        <section className="admin-csv-imports__panel" aria-labelledby="admin-csv-imports-detail-heading">
          <header className="admin-csv-imports__panel-header">
            <h2 id="admin-csv-imports-detail-heading">Batch detail</h2>
            <p>Inspect row-level results, exact failures, and import timestamps for the selected batch.</p>
          </header>

          {renderDetailState(props)}
        </section>
      </div>
    </div>
  );
}

export function AdminCsvImportManager() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputResetToken, setFileInputResetToken] = useState(0);
  const [uploadState, setUploadState] = useState<AdminCsvImportUploadState>(IDLE_UPLOAD_STATE);
  const [listState, setListState] = useState<AdminCsvImportListState>(INITIAL_LIST_STATE);
  const [detailState, setDetailState] = useState<AdminCsvImportDetailState>(INITIAL_DETAIL_STATE);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [listReloadToken, setListReloadToken] = useState(0);
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  const [isRefreshingList, setIsRefreshingList] = useState(false);
  const [isRefreshingDetail, setIsRefreshingDetail] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    const keepCurrentListVisible = listState.status === "ready";

    if (!keepCurrentListVisible) {
      setListState(INITIAL_LIST_STATE);
    } else {
      setIsRefreshingList(true);
    }

    async function loadBatches(): Promise<void> {
      try {
        const items = await fetchAdminCsvImportBatches(abortController.signal);

        if (abortController.signal.aborted) {
          return;
        }

        setListState({
          status: "ready",
          items,
          error: null,
        });

        const nextSelectedBatchId = resolveNextSelectedBatchId(selectedBatchId, items);

        if (nextSelectedBatchId !== selectedBatchId) {
          setSelectedBatchId(nextSelectedBatchId);
          setDetailPage(1);

          if (nextSelectedBatchId === null) {
            setDetailState(INITIAL_DETAIL_STATE);
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setListState({
          status: "error",
          items: [],
          error: getListErrorMessage(error),
        });
        setSelectedBatchId(null);
        setDetailPage(1);
        setDetailState(INITIAL_DETAIL_STATE);
      } finally {
        if (!abortController.signal.aborted) {
          setIsRefreshingList(false);
        }
      }
    }

    void loadBatches();

    return () => {
      abortController.abort();
    };
  }, [listReloadToken]);

  useEffect(() => {
    if (!selectedBatchId) {
      setDetailState(INITIAL_DETAIL_STATE);
      setIsRefreshingDetail(false);
      return;
    }

    const abortController = new AbortController();
    const keepCurrentDetailVisible =
      detailState.status === "ready" &&
      detailState.data?.id === selectedBatchId &&
      detailState.data?.page === detailPage;

    if (!keepCurrentDetailVisible) {
      setDetailState({
        status: "loading",
        data: null,
        error: null,
      });
    } else {
      setIsRefreshingDetail(true);
    }

    const batchId = selectedBatchId;

    async function loadBatchDetail(): Promise<void> {
      try {
        const detail = await fetchAdminCsvImportBatchDetail(
          batchId,
          { page: detailPage },
          abortController.signal,
        );

        if (abortController.signal.aborted) {
          return;
        }

        setDetailState({
          status: "ready",
          data: detail,
          error: null,
        });
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setDetailState({
          status: "error",
          data: null,
          error: getDetailErrorMessage(error),
        });
      } finally {
        if (!abortController.signal.aborted) {
          setIsRefreshingDetail(false);
        }
      }
    }

    void loadBatchDetail();

    return () => {
      abortController.abort();
    };
  }, [selectedBatchId, detailPage, detailReloadToken]);

  useEffect(() => {
    const shouldPollList =
      listState.status === "ready" && shouldPollAdminCsvImportList(listState.items);
    const shouldPollDetail =
      detailState.status === "ready" && shouldPollAdminCsvImportDetail(detailState.data);

    if (!shouldPollList && !shouldPollDetail) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (shouldPollList) {
        setListReloadToken((current) => current + 1);
      }

      if (shouldPollDetail) {
        setDetailReloadToken((current) => current + 1);
      }
    }, ADMIN_CSV_IMPORT_POLL_INTERVAL_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [listState, detailState]);

  async function handleUpload(): Promise<void> {
    const validationError = getCsvImportUploadValidationError(selectedFile);

    if (validationError) {
      setUploadState({
        type: "error",
        message: validationError,
      });
      return;
    }

    const file = selectedFile;

    if (!file) {
      return;
    }

    setUploadState({
      type: "submitting",
      message: "",
    });

    try {
      const batch = await createAdminCsvImportBatch(file);

      setUploadState({
        type: "success",
        message: getUploadSuccessMessage(batch),
      });
      setSelectedFile(null);
      setFileInputResetToken((current) => current + 1);
      setSelectedBatchId(batch.id);
      setDetailPage(1);
      setDetailState({
        status: "loading",
        data: null,
        error: null,
      });
      setListState((current) => {
        const currentItems = current.status === "ready" ? current.items : [];
        return {
          status: "ready",
          items: [batch, ...currentItems.filter((item) => item.id !== batch.id)],
          error: null,
        };
      });
      setListReloadToken((current) => current + 1);
      setDetailReloadToken((current) => current + 1);
    } catch (error) {
      setUploadState({
        type: "error",
        message: getUploadErrorMessage(error),
      });
    }
  }

  function handleFileChange(file: File | null): void {
    setSelectedFile(file);

    if (uploadState.type !== "idle") {
      setUploadState(IDLE_UPLOAD_STATE);
    }
  }

  function handleReload(): void {
    setListReloadToken((current) => current + 1);

    if (selectedBatchId) {
      setDetailReloadToken((current) => current + 1);
    }
  }

  function handleRetryList(): void {
    setListState(INITIAL_LIST_STATE);
    setListReloadToken((current) => current + 1);
  }

  function handleRetryDetail(): void {
    if (!selectedBatchId) {
      return;
    }

    setDetailState({
      status: "loading",
      data: null,
      error: null,
    });
    setDetailReloadToken((current) => current + 1);
  }

  function handleSelectBatch(batchId: string): void {
    if (batchId === selectedBatchId && detailPage === 1) {
      return;
    }

    setSelectedBatchId(batchId);
    setDetailPage(1);
    setDetailState({
      status: "loading",
      data: null,
      error: null,
    });
  }

  function handlePreviousPage(): void {
    setDetailPage((current) => Math.max(1, current - 1));
  }

  function handleNextPage(): void {
    if (detailState.status !== "ready" || !detailState.data) {
      return;
    }

    const hasNextPage = detailState.data.page * detailState.data.pageSize < detailState.data.totalRowCount;

    if (!hasNextPage) {
      return;
    }

    setDetailPage((current) => current + 1);
  }

  return (
    <AdminCsvImportManagerView
      detailState={detailState}
      fileInputResetToken={fileInputResetToken}
      isRefreshingDetail={isRefreshingDetail}
      isRefreshingList={isRefreshingList}
      listState={listState}
      onFileChange={handleFileChange}
      onNextPage={handleNextPage}
      onPreviousPage={handlePreviousPage}
      onReload={handleReload}
      onRetryDetail={handleRetryDetail}
      onRetryList={handleRetryList}
      onSelectBatch={handleSelectBatch}
      onUpload={handleUpload}
      selectedBatchId={selectedBatchId}
      selectedFileName={selectedFile?.name ?? ""}
      uploadState={uploadState}
    />
  );
}
