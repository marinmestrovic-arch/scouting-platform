import {
  createHubspotImportBatchRequestSchema,
  hubspotImportBatchDetailSchema,
  hubspotImportBatchSummarySchema,
  hubspotImportBatchValidationErrorSchema,
  listHubspotImportBatchesResponseSchema,
  type CreateHubspotImportBatchRequest,
  type HubspotImportBatchDetail,
  type HubspotImportBatchSummary,
  type HubspotImportBatchValidationError,
} from "@scouting-platform/contracts";

const GENERIC_REQUEST_ERROR_MESSAGE = "Unable to complete the request. Please try again.";
const INVALID_CREATE_RESPONSE_ERROR_MESSAGE =
  "Received an invalid HubSpot import creation response.";
const INVALID_DETAIL_RESPONSE_ERROR_MESSAGE =
  "Received an invalid HubSpot import detail response.";
const INVALID_LIST_RESPONSE_ERROR_MESSAGE =
  "Received an invalid HubSpot import history response.";

type ApiErrorBody = {
  error?: string;
};

export class HubspotImportBatchesApiError extends Error {
  readonly status: number;
  readonly validation: HubspotImportBatchValidationError | null;

  constructor(message: string, status: number, validation: HubspotImportBatchValidationError | null = null) {
    super(message);
    this.name = "HubspotImportBatchesApiError";
    this.status = status;
    this.validation = validation;
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
    return "You are not authorized to manage HubSpot imports.";
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
  if (error instanceof HubspotImportBatchesApiError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return error;
  }

  return new Error(normalizeErrorMessage(error, fallbackMessage));
}

export async function createHubspotImportBatch(
  input: CreateHubspotImportBatchRequest,
): Promise<HubspotImportBatchSummary> {
  const requestPayload = createHubspotImportBatchRequestSchema.parse(input);

  try {
    const response = await fetch("/api/hubspot-import-batches", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      const validation = hubspotImportBatchValidationErrorSchema.safeParse(payload);

      throw new HubspotImportBatchesApiError(
        getApiErrorMessage(response, payload),
        response.status,
        validation.success ? validation.data : null,
      );
    }

    const parsed = hubspotImportBatchSummarySchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_CREATE_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function fetchHubspotImportBatches(
  signal?: AbortSignal,
): Promise<HubspotImportBatchSummary[]> {
  try {
    const response = await fetch("/api/hubspot-import-batches", {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new HubspotImportBatchesApiError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = listHubspotImportBatchesResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_LIST_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data.items;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function fetchHubspotImportBatchDetail(
  batchId: string,
  signal?: AbortSignal,
): Promise<HubspotImportBatchDetail> {
  try {
    const response = await fetch(`/api/hubspot-import-batches/${encodeURIComponent(batchId)}`, {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new HubspotImportBatchesApiError(
        getApiErrorMessage(response, payload, {
          notFoundErrorMessage: "HubSpot import batch not found.",
        }),
        response.status,
      );
    }

    const parsed = hubspotImportBatchDetailSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_DETAIL_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export function getHubspotImportBatchDownloadUrl(batchId: string): string {
  return `/api/hubspot-import-batches/${encodeURIComponent(batchId)}/download`;
}
