import {
  csvExportPreviewSchema,
  hubspotExportPreviewSchema,
  hubspotPrepUpdateRequestSchema,
  type CsvExportPreview,
  type HubspotPrepUpdateRequest,
  type HubspotExportPreview,
} from "@scouting-platform/contracts";

type ApiErrorBody = {
  error?: string;
};

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getApiErrorMessage(response: Response, payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && typeof (payload as ApiErrorBody).error === "string") {
    return (payload as ApiErrorBody).error as string;
  }

  if (response.status === 401 || response.status === 403) {
    return "You are not authorized to access this export preview.";
  }

  return fallback;
}

export async function fetchHubspotExportPreview(runId: string, signal?: AbortSignal): Promise<HubspotExportPreview> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/hubspot-preview`, {
    method: "GET",
    cache: "no-store",
    signal: signal ?? null,
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(response, payload, "Unable to load HubSpot preview."));
  }

  return hubspotExportPreviewSchema.parse(payload);
}

export async function fetchCsvExportPreview(runId: string, signal?: AbortSignal): Promise<CsvExportPreview> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/csv-preview`, {
    method: "GET",
    cache: "no-store",
    signal: signal ?? null,
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(response, payload, "Unable to load CSV preview."));
  }

  return csvExportPreviewSchema.parse(payload);
}

export async function updateHubspotExportPreview(
  runId: string,
  input: HubspotPrepUpdateRequest,
): Promise<HubspotExportPreview> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/hubspot-preview`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(hubspotPrepUpdateRequestSchema.parse(input)),
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(response, payload, "Unable to update HubSpot preview."));
  }

  return hubspotExportPreviewSchema.parse(payload);
}
