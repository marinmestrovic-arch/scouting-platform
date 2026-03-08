import {
  listChannelsQuerySchema,
  listChannelsResponseSchema,
  type ListChannelsQuery,
  type ListChannelsResponse,
} from "@scouting-platform/contracts";

const GENERIC_REQUEST_ERROR_MESSAGE = "Unable to load channels. Please try again.";
const INVALID_RESPONSE_ERROR_MESSAGE = "Received an invalid response from the server.";

type ApiErrorBody = {
  error?: string;
};

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return GENERIC_REQUEST_ERROR_MESSAGE;
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
    return "You are not authorized to view the catalog.";
  }

  return GENERIC_REQUEST_ERROR_MESSAGE;
}

export async function fetchChannels(
  input: Pick<ListChannelsQuery, "page" | "pageSize" | "query">,
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

  try {
    const response = await fetch(`/api/channels?${searchParams.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new Error(getApiErrorMessage(response, payload));
    }

    const parsed = listChannelsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw new Error(normalizeErrorMessage(error));
  }
}
