import {
  csvExportPreviewSchema,
  createHubspotPreviewEnrichmentResponseSchema,
  getHubspotPreviewEnrichmentStatusResponseSchema,
  hubspotExportPreviewSchema,
  hubspotPreviewEnrichmentResponseSchema,
  hubspotPrepUpdateRequestSchema,
  type CsvExportPreview,
  type CreateHubspotPreviewEnrichmentResponse,
  type GetHubspotPreviewEnrichmentStatusResponse,
  type HubspotPrepUpdateRequest,
  type HubspotExportPreview,
  type HubspotPreviewEnrichmentJobSummary,
  type HubspotPreviewEnrichmentResponse,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

export async function enrichHubspotExportPreview(
  runId: string,
  options?: {
    onProgress?: (progress: { percentage: number; message: string }) => void;
  },
): Promise<HubspotPreviewEnrichmentResponse> {
  const createResponse = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/hubspot-preview/enrichment`,
    { method: "POST" },
  );
  const createPayload = await readJsonPayload(createResponse);

  if (!createResponse.ok) {
    throw new Error(
      getApiErrorMessage(createResponse, createPayload, "Unable to enrich HubSpot preview."),
    );
  }

  const created: CreateHubspotPreviewEnrichmentResponse =
    createHubspotPreviewEnrichmentResponseSchema.parse(createPayload);
  let job: HubspotPreviewEnrichmentJobSummary = created.job;

  options?.onProgress?.({
    percentage: job.progressPercentage,
    message: job.progressMessage ?? "Creator List enrichment queued.",
  });

  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (job.status === "completed") {
      const preview = await fetchHubspotExportPreview(runId);

      return hubspotPreviewEnrichmentResponseSchema.parse({
        preview,
        processedChannelCount: job.processedChannelCount,
        updatedRowCount: job.updatedRowCount,
        updatedFieldCount: job.updatedFieldCount,
        failedChannelCount: job.failedChannelCount,
      });
    }

    if (job.status === "failed") {
      throw new Error(job.lastError ?? "Creator List enrichment failed.");
    }

    await sleep(1_500);

    const statusResponse = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/hubspot-preview/enrichment/${encodeURIComponent(job.id)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );
    const statusPayload = await readJsonPayload(statusResponse);

    if (!statusResponse.ok) {
      throw new Error(
        getApiErrorMessage(statusResponse, statusPayload, "Unable to load enrichment status."),
      );
    }

    const status: GetHubspotPreviewEnrichmentStatusResponse =
      getHubspotPreviewEnrichmentStatusResponseSchema.parse(statusPayload);
    job = status.job;
    options?.onProgress?.({
      percentage: job.progressPercentage,
      message: job.progressMessage ?? "Creator List enrichment is running.",
    });
  }

  throw new Error("Creator List enrichment is still running. Refresh this page to check progress.");
}
