import {
  createSegmentRequestSchema,
  listSegmentsResponseSchema,
  segmentResponseSchema,
  type CreateSegmentRequest,
  type SegmentResponse,
} from "@scouting-platform/contracts";

const GENERIC_SEGMENTS_REQUEST_ERROR_MESSAGE =
  "Unable to manage saved segments. Please try again.";
const INVALID_SEGMENTS_RESPONSE_ERROR_MESSAGE =
  "Received an invalid saved segments response from the server.";

type ApiErrorBody = {
  error?: string;
};

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return GENERIC_SEGMENTS_REQUEST_ERROR_MESSAGE;
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
    return "You are not authorized to manage saved segments.";
  }

  if (response.status === 404) {
    return "Saved segment not found.";
  }

  return GENERIC_SEGMENTS_REQUEST_ERROR_MESSAGE;
}

export async function fetchSavedSegments(signal?: AbortSignal): Promise<SegmentResponse[]> {
  try {
    const response = await fetch("/api/segments", {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new Error(getApiErrorMessage(response, payload));
    }

    const parsed = listSegmentsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_SEGMENTS_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data.items;
  } catch (error) {
    throw new Error(normalizeErrorMessage(error));
  }
}

export async function createSavedSegment(input: CreateSegmentRequest): Promise<SegmentResponse> {
  const requestPayload = createSegmentRequestSchema.parse(input);

  try {
    const response = await fetch("/api/segments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new Error(getApiErrorMessage(response, payload));
    }

    const parsed = segmentResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_SEGMENTS_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw new Error(normalizeErrorMessage(error));
  }
}

export async function deleteSavedSegment(segmentId: string): Promise<void> {
  try {
    const response = await fetch(`/api/segments/${encodeURIComponent(segmentId)}`, {
      method: "DELETE",
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new Error(getApiErrorMessage(response, payload));
    }
  } catch (error) {
    throw new Error(normalizeErrorMessage(error));
  }
}
