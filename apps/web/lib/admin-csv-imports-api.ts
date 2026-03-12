import {
  csvImportBatchDetailSchema,
  csvImportBatchSummarySchema,
  listCsvImportBatchesResponseSchema,
  type CsvImportBatchDetail,
  type CsvImportBatchSummary,
} from "@scouting-platform/contracts";

const GENERIC_REQUEST_ERROR_MESSAGE = "Unable to complete the request. Please try again.";
const INVALID_LIST_RESPONSE_ERROR_MESSAGE = "Received an invalid CSV import list response.";
const INVALID_DETAIL_RESPONSE_ERROR_MESSAGE = "Received an invalid CSV import detail response.";
const INVALID_UPLOAD_RESPONSE_ERROR_MESSAGE = "Received an invalid CSV import upload response.";

type ApiErrorBody = {
  error?: string;
};

export class AdminCsvImportsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminCsvImportsApiError";
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

function getApiErrorMessage(response: Response, payload: unknown): string {
  if (payload && typeof payload === "object") {
    const maybeErrorPayload = payload as ApiErrorBody;

    if (typeof maybeErrorPayload.error === "string" && maybeErrorPayload.error.trim().length > 0) {
      return maybeErrorPayload.error;
    }
  }

  if (response.status === 401 || response.status === 403) {
    return "You are not authorized to manage CSV imports.";
  }

  return GENERIC_REQUEST_ERROR_MESSAGE;
}

function normalizeRequestError(
  error: unknown,
  fallbackMessage = GENERIC_REQUEST_ERROR_MESSAGE,
): Error {
  if (error instanceof AdminCsvImportsApiError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return error;
  }

  return new Error(normalizeErrorMessage(error, fallbackMessage));
}

export async function fetchAdminCsvImportBatches(signal?: AbortSignal): Promise<CsvImportBatchSummary[]> {
  try {
    const response = await fetch("/api/admin/csv-import-batches", {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new AdminCsvImportsApiError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = listCsvImportBatchesResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_LIST_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data.items;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function fetchAdminCsvImportBatchDetail(
  batchId: string,
  input?: { page?: number },
  signal?: AbortSignal,
): Promise<CsvImportBatchDetail> {
  const searchParams = new URLSearchParams();

  if (input?.page) {
    searchParams.set("page", String(input.page));
  }

  try {
    const response = await fetch(
      `/api/admin/csv-import-batches/${encodeURIComponent(batchId)}${
        searchParams.size > 0 ? `?${searchParams.toString()}` : ""
      }`,
      {
        method: "GET",
        cache: "no-store",
        signal: signal ?? null,
      },
    );
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new AdminCsvImportsApiError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = csvImportBatchDetailSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_DETAIL_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function createAdminCsvImportBatch(file: File): Promise<CsvImportBatchSummary> {
  const formData = new FormData();
  formData.append("file", file, file.name);

  try {
    const response = await fetch("/api/admin/csv-import-batches", {
      method: "POST",
      body: formData,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new AdminCsvImportsApiError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = csvImportBatchSummarySchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_UPLOAD_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}
