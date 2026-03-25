import {
  listCampaignManagersResponseSchema,
  type CampaignManagerOption,
} from "@scouting-platform/contracts";

type ApiErrorBody = {
  error?: string;
};

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to load campaign managers. Please try again.";
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
    return "You are not authorized to load campaign managers.";
  }

  return "Unable to load campaign managers. Please try again.";
}

export async function fetchCampaignManagers(signal?: AbortSignal): Promise<CampaignManagerOption[]> {
  try {
    const response = await fetch("/api/users/campaign-managers", {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new Error(getApiErrorMessage(response, payload));
    }

    const parsed = listCampaignManagersResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error("Received an invalid campaign manager response.");
    }

    return parsed.data.items;
  } catch (error) {
    throw new Error(normalizeErrorMessage(error));
  }
}
