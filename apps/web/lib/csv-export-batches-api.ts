import {
  createCsvExportBatchRequestSchema,
  csvExportBatchDetailSchema,
  listCsvExportBatchesResponseSchema,
  csvExportBatchSummarySchema,
  type CreateCsvExportBatchRequest,
  type CsvExportBatchDetail,
  type CsvExportBatchSummary,
  type ListCsvExportBatchesResponse,
} from "@scouting-platform/contracts";

const GENERIC_REQUEST_ERROR_MESSAGE = "Unable to complete the request. Please try again.";
const INVALID_CREATE_RESPONSE_ERROR_MESSAGE =
  "Received an invalid CSV export creation response.";
const INVALID_DETAIL_RESPONSE_ERROR_MESSAGE =
  "Received an invalid CSV export detail response.";
const INVALID_LIST_RESPONSE_ERROR_MESSAGE =
  "Received an invalid CSV export list response.";

type ApiErrorBody = {
  error?: string;
};

export class CsvExportBatchesApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CsvExportBatchesApiError";
    this.status = status;
  }
}

function normalizeErrorMessage(error: unknown, fallbackMessage = GENERIC_REQUEST_ERROR_MESSAGE): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getApiErrorMessage(
  response: Response,
  payload: unknown,
  options?: {
    notFoundErrorMessage?: string;
  },
): string {
  if (payload && typeof payload === "object") {
    const maybeErrorPayload = payload as ApiErrorBody;

    if (typeof maybeErrorPayload.error === "string" && maybeErrorPayload.error.trim().length > 0) {
      return maybeErrorPayload.error;
    }
  }

  if (response.status === 401 || response.status === 403) {
    return "You are not authorized to manage CSV exports.";
  }

  if (response.status === 404 && options?.notFoundErrorMessage) {
    return options.notFoundErrorMessage;
  }

  return GENERIC_REQUEST_ERROR_MESSAGE;
}

function normalizeRequestError(
  error: unknown,
  fallbackMessage = GENERIC_REQUEST_ERROR_MESSAGE,
): Error {
  if (error instanceof CsvExportBatchesApiError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return error;
  }

  return new Error(normalizeErrorMessage(error, fallbackMessage));
}

export async function createCsvExportBatch(
  input: CreateCsvExportBatchRequest,
): Promise<CsvExportBatchSummary> {
  const requestPayload = createCsvExportBatchRequestSchema.parse(input);

  try {
    const response = await fetch("/api/csv-export-batches", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new CsvExportBatchesApiError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = csvExportBatchSummarySchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_CREATE_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function fetchCsvExportBatches(
  signal?: AbortSignal,
): Promise<ListCsvExportBatchesResponse["items"]> {
  try {
    const response = await fetch("/api/csv-export-batches", {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new CsvExportBatchesApiError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = listCsvExportBatchesResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_LIST_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data.items;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function fetchCsvExportBatchDetail(
  batchId: string,
  signal?: AbortSignal,
): Promise<CsvExportBatchDetail> {
  try {
    const response = await fetch(`/api/csv-export-batches/${encodeURIComponent(batchId)}`, {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new CsvExportBatchesApiError(
        getApiErrorMessage(response, payload, {
          notFoundErrorMessage: "CSV export batch not found.",
        }),
        response.status,
      );
    }

    const parsed = csvExportBatchDetailSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_DETAIL_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export function getCsvExportBatchDownloadUrl(batchId: string): string {
  return `/api/csv-export-batches/${encodeURIComponent(batchId)}/download`;
}
