import {
  adminAdvancedReportRequestDetailSchema,
  decideAdvancedReportRequestSchema,
  listAdminAdvancedReportRequestsResponseSchema,
  type AdminAdvancedReportRequestDetail,
  type AdminAdvancedReportRequestSummary,
  type AdvancedReportRequestStatus,
  type DecideAdvancedReportRequest,
} from "@scouting-platform/contracts";

const GENERIC_REQUEST_ERROR_MESSAGE = "Unable to complete the request. Please try again.";
const INVALID_LIST_RESPONSE_ERROR_MESSAGE = "Received an invalid advanced report list response.";
const INVALID_DETAIL_RESPONSE_ERROR_MESSAGE = "Received an invalid advanced report detail response.";

type ApiErrorBody = {
  error?: string;
};

export class AdminAdvancedReportApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminAdvancedReportApiError";
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
    return "You are not authorized to manage advanced report requests.";
  }

  return GENERIC_REQUEST_ERROR_MESSAGE;
}

function normalizeRequestError(
  error: unknown,
  fallbackMessage = GENERIC_REQUEST_ERROR_MESSAGE,
): Error {
  if (error instanceof AdminAdvancedReportApiError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return error;
  }

  return new Error(normalizeErrorMessage(error, fallbackMessage));
}

export async function fetchAdminAdvancedReportRequests(
  input?: {
    status?: AdvancedReportRequestStatus;
  },
  signal?: AbortSignal,
): Promise<AdminAdvancedReportRequestSummary[]> {
  const searchParams = new URLSearchParams();

  if (input?.status) {
    searchParams.set("status", input.status);
  }

  try {
    const response = await fetch(
      `/api/admin/advanced-report-requests${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
      {
        method: "GET",
        cache: "no-store",
        signal: signal ?? null,
      },
    );
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new AdminAdvancedReportApiError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = listAdminAdvancedReportRequestsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_LIST_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data.items;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function fetchAdminAdvancedReportRequestDetail(
  requestId: string,
  signal?: AbortSignal,
): Promise<AdminAdvancedReportRequestDetail> {
  try {
    const response = await fetch(`/api/admin/advanced-report-requests/${encodeURIComponent(requestId)}`, {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new AdminAdvancedReportApiError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = adminAdvancedReportRequestDetailSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_DETAIL_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

async function submitAdvancedReportDecision(
  requestId: string,
  action: "approve" | "reject",
  input?: DecideAdvancedReportRequest,
): Promise<AdminAdvancedReportRequestDetail> {
  const requestPayload = decideAdvancedReportRequestSchema.parse(input ?? {});

  try {
    const response = await fetch(
      `/api/admin/advanced-report-requests/${encodeURIComponent(requestId)}/${action}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      },
    );
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new AdminAdvancedReportApiError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = adminAdvancedReportRequestDetailSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_DETAIL_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function approveAdminAdvancedReportRequest(
  requestId: string,
  input?: DecideAdvancedReportRequest,
): Promise<AdminAdvancedReportRequestDetail> {
  return submitAdvancedReportDecision(requestId, "approve", input);
}

export async function rejectAdminAdvancedReportRequest(
  requestId: string,
  input?: DecideAdvancedReportRequest,
): Promise<AdminAdvancedReportRequestDetail> {
  return submitAdvancedReportDecision(requestId, "reject", input);
}
