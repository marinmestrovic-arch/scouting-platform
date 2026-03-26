import {
  campaignSummarySchema,
  createCampaignRequestSchema as createCampaignPayloadSchema,
  listCampaignsResponseSchema,
  type CampaignSummary,
  type CreateCampaignRequest,
  type ListCampaignsResponse,
} from "@scouting-platform/contracts";

type ApiErrorBody = {
  error?: string;
};

export class CampaignsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CampaignsApiError";
    this.status = status;
  }
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getApiErrorMessage(response: Response, payload: unknown): string {
  if (payload && typeof payload === "object" && typeof (payload as ApiErrorBody).error === "string") {
    return (payload as ApiErrorBody).error as string;
  }

  if (response.status === 401 || response.status === 403) {
    return "You are not authorized to manage campaigns.";
  }

  return "Unable to complete the request. Please try again.";
}

export async function fetchCampaigns(input?: {
  clientId?: string;
  marketId?: string;
  active?: boolean;
  signal?: AbortSignal;
}): Promise<ListCampaignsResponse> {
  const params = new URLSearchParams();

  if (input?.clientId) {
    params.set("clientId", input.clientId);
  }

  if (input?.marketId) {
    params.set("marketId", input.marketId);
  }

  if (typeof input?.active === "boolean") {
    params.set("active", input.active ? "true" : "false");
  }

  const response = await fetch(`/api/campaigns${params.size > 0 ? `?${params.toString()}` : ""}`, {
    method: "GET",
    cache: "no-store",
    signal: input?.signal ?? null,
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new CampaignsApiError(getApiErrorMessage(response, payload), response.status);
  }

  return listCampaignsResponseSchema.parse(payload);
}

export async function createCampaignRequest(input: CreateCampaignRequest): Promise<CampaignSummary> {
  const response = await fetch("/api/campaigns", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(createCampaignPayloadSchema.parse(input)),
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new CampaignsApiError(getApiErrorMessage(response, payload), response.status);
  }

  return campaignSummarySchema.parse(payload);
}
