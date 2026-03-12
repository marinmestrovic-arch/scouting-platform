import {
  channelDetailSchema,
  listChannelsQuerySchema,
  listChannelsResponseSchema,
  requestAdvancedReportResponseSchema,
  requestChannelEnrichmentResponseSchema,
  type CatalogChannelFilters,
  type ChannelEnrichmentDetail,
  type ChannelDetail,
  type ListChannelsQuery,
  type ListChannelsResponse,
  type RequestAdvancedReportResponse,
  type RequestChannelEnrichmentResponse,
} from "@scouting-platform/contracts";

const GENERIC_CHANNELS_REQUEST_ERROR_MESSAGE = "Unable to load channels. Please try again.";
const GENERIC_CHANNEL_DETAIL_REQUEST_ERROR_MESSAGE =
  "Unable to load channel details. Please try again.";
const GENERIC_CHANNEL_ENRICHMENT_REQUEST_ERROR_MESSAGE =
  "Unable to request channel enrichment. Please try again.";
const GENERIC_CHANNEL_ADVANCED_REPORT_REQUEST_ERROR_MESSAGE =
  "Unable to request channel advanced report. Please try again.";
const INVALID_CHANNELS_RESPONSE_ERROR_MESSAGE = "Received an invalid response from the server.";
const INVALID_CHANNEL_DETAIL_RESPONSE_ERROR_MESSAGE =
  "Received an invalid channel detail response from the server.";
const INVALID_CHANNEL_ENRICHMENT_RESPONSE_ERROR_MESSAGE =
  "Received an invalid channel enrichment response from the server.";
const INVALID_CHANNEL_ADVANCED_REPORT_RESPONSE_ERROR_MESSAGE =
  "Received an invalid channel advanced report response from the server.";

type ApiErrorBody = {
  error?: string;
};

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export type BatchChannelEnrichmentRequestSuccess = {
  channelId: string;
  ok: true;
  enrichment: ChannelEnrichmentDetail;
};

export type BatchChannelEnrichmentRequestFailure = {
  channelId: string;
  ok: false;
  error: Error;
};

export type BatchChannelEnrichmentRequestResult =
  | BatchChannelEnrichmentRequestSuccess
  | BatchChannelEnrichmentRequestFailure;

function normalizeErrorMessage(error: unknown, fallbackMessage: string): string {
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
    authorizationErrorMessage?: string;
    notFoundErrorMessage?: string;
    fallbackMessage?: string;
  },
): string {
  if (payload && typeof payload === "object") {
    const maybeErrorPayload = payload as ApiErrorBody;

    if (typeof maybeErrorPayload.error === "string" && maybeErrorPayload.error.trim().length > 0) {
      return maybeErrorPayload.error;
    }
  }

  if (response.status === 401 || response.status === 403) {
    return options?.authorizationErrorMessage ?? "You are not authorized to view the catalog.";
  }

  if (response.status === 404 && options?.notFoundErrorMessage) {
    return options.notFoundErrorMessage;
  }

  return options?.fallbackMessage ?? GENERIC_CHANNELS_REQUEST_ERROR_MESSAGE;
}

function normalizeRequestError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof ApiRequestError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return error;
  }

  return new Error(normalizeErrorMessage(error, fallbackMessage));
}

export async function fetchChannels(
  input: Pick<
    ListChannelsQuery,
    "page" | "pageSize" | "query" | "enrichmentStatus" | "advancedReportStatus"
  >,
  signal?: AbortSignal,
): Promise<ListChannelsResponse> {
  const requestQuery = listChannelsQuerySchema.parse(input);
  const searchParams = new URLSearchParams({
    page: String(requestQuery.page),
    pageSize: String(requestQuery.pageSize),
  });

  if (requestQuery.query) {
    searchParams.set("query", requestQuery.query);
  }

  appendStatusFilters(searchParams, requestQuery);

  try {
    const response = await fetch(`/api/channels?${searchParams.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new ApiRequestError(getApiErrorMessage(response, payload), response.status);
    }

    const parsed = listChannelsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_CHANNELS_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error, GENERIC_CHANNELS_REQUEST_ERROR_MESSAGE);
  }
}

export async function fetchChannelDetail(
  channelId: string,
  signal?: AbortSignal,
): Promise<ChannelDetail> {
  try {
    const response = await fetch(`/api/channels/${channelId}`, {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new ApiRequestError(
        getApiErrorMessage(response, payload, {
          authorizationErrorMessage: "You are not authorized to view this channel.",
          notFoundErrorMessage: "Channel not found.",
          fallbackMessage: GENERIC_CHANNEL_DETAIL_REQUEST_ERROR_MESSAGE,
        }),
        response.status,
      );
    }

    const parsed = channelDetailSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_CHANNEL_DETAIL_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error, GENERIC_CHANNEL_DETAIL_REQUEST_ERROR_MESSAGE);
  }
}

export async function requestChannelEnrichment(
  channelId: string,
): Promise<RequestChannelEnrichmentResponse> {
  try {
    const response = await fetch(`/api/channels/${channelId}/enrich`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new ApiRequestError(
        getApiErrorMessage(response, payload, {
          authorizationErrorMessage: "You are not authorized to enrich this channel.",
          notFoundErrorMessage: "Channel not found.",
          fallbackMessage: GENERIC_CHANNEL_ENRICHMENT_REQUEST_ERROR_MESSAGE,
        }),
        response.status,
      );
    }

    const parsed = requestChannelEnrichmentResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_CHANNEL_ENRICHMENT_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error, GENERIC_CHANNEL_ENRICHMENT_REQUEST_ERROR_MESSAGE);
  }
}

export async function requestChannelAdvancedReport(
  channelId: string,
): Promise<RequestAdvancedReportResponse> {
  try {
    const response = await fetch(`/api/channels/${channelId}/advanced-report-requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new ApiRequestError(
        getApiErrorMessage(response, payload, {
          authorizationErrorMessage:
            "You are not authorized to request an advanced report for this channel.",
          notFoundErrorMessage: "Channel not found.",
          fallbackMessage: GENERIC_CHANNEL_ADVANCED_REPORT_REQUEST_ERROR_MESSAGE,
        }),
        response.status,
      );
    }

    const parsed = requestAdvancedReportResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_CHANNEL_ADVANCED_REPORT_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw normalizeRequestError(error, GENERIC_CHANNEL_ADVANCED_REPORT_REQUEST_ERROR_MESSAGE);
  }
}

export async function requestChannelEnrichmentBatch(
  channelIds: readonly string[],
): Promise<BatchChannelEnrichmentRequestResult[]> {
  const uniqueChannelIds = [...new Set(channelIds)];

  return Promise.all(
    uniqueChannelIds.map(async (channelId) => {
      try {
        const response = await requestChannelEnrichment(channelId);

        return {
          channelId: response.channelId,
          ok: true,
          enrichment: response.enrichment,
        } satisfies BatchChannelEnrichmentRequestSuccess;
      } catch (error) {
        return {
          channelId,
          ok: false,
          error: normalizeRequestError(error, GENERIC_CHANNEL_ENRICHMENT_REQUEST_ERROR_MESSAGE),
        } satisfies BatchChannelEnrichmentRequestFailure;
      }
    }),
  );
}

function appendStatusFilters(
  searchParams: URLSearchParams,
  requestQuery: CatalogChannelFilters,
): void {
  for (const status of requestQuery.enrichmentStatus ?? []) {
    searchParams.append("enrichmentStatus", status);
  }

  for (const status of requestQuery.advancedReportStatus ?? []) {
    searchParams.append("advancedReportStatus", status);
  }
}
