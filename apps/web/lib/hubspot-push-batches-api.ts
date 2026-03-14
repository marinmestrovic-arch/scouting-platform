import {
  createHubspotPushBatchRequestSchema,
  hubspotPushBatchDetailSchema,
  hubspotPushBatchSummarySchema,
  listHubspotPushBatchesResponseSchema,
  type CreateHubspotPushBatchRequest,
  type HubspotPushBatchDetail,
  type HubspotPushBatchSummary,
} from "@scouting-platform/contracts";

const GENERIC_REQUEST_ERROR_MESSAGE = "Unable to complete the request. Please try again.";
const INVALID_CREATE_RESPONSE_ERROR_MESSAGE =
  "Received an invalid HubSpot push creation response.";
const INVALID_DETAIL_RESPONSE_ERROR_MESSAGE =
  "Received an invalid HubSpot push detail response.";
const INVALID_LIST_RESPONSE_ERROR_MESSAGE =
  "Received an invalid HubSpot push history response.";

type ApiErrorBody = {
  error?: string;
};

export class HubspotPushBatchesApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HubspotPushBatchesApiError";
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
    return "You are not authorized to manage HubSpot pushes.";
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
  if (error instanceof HubspotPushBatchesApiError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return error;
  }

  return new Error(normalizeErrorMessage(error, fallbackMessage));
}

export async function createHubspotPushBatch(
  input: CreateHubspotPushBatchRequest,
): Promise<HubspotPushBatchSummary> {
  const requestPayload = createHubspotPushBatchRequestSchema.parse(input);

  try {
    const response = await fetch("/api/hubspot-push-batches", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new HubspotPushBatchesApiError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = hubspotPushBatchSummarySchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_CREATE_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function fetchHubspotPushBatches(
  signal?: AbortSignal,
): Promise<HubspotPushBatchSummary[]> {
  try {
    const response = await fetch("/api/hubspot-push-batches", {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new HubspotPushBatchesApiError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = listHubspotPushBatchesResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_LIST_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data.items;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function fetchHubspotPushBatchDetail(
  batchId: string,
  signal?: AbortSignal,
): Promise<HubspotPushBatchDetail> {
  try {
    const response = await fetch(`/api/hubspot-push-batches/${encodeURIComponent(batchId)}`, {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new HubspotPushBatchesApiError(
        getApiErrorMessage(response, payload, {
          notFoundErrorMessage: "HubSpot push batch not found.",
        }),
        response.status,
      );
    }

    const parsed = hubspotPushBatchDetailSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_DETAIL_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}
