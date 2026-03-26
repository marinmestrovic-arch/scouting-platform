import {
  clientSummarySchema,
  createClientRequestSchema,
  listClientsResponseSchema,
  type ClientSummary,
  type CreateClientRequest,
  type ListClientsResponse,
} from "@scouting-platform/contracts";

type ApiErrorBody = {
  error?: string;
};

export class ClientsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ClientsApiError";
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
    return "You are not authorized to manage clients.";
  }

  return "Unable to complete the request. Please try again.";
}

export async function fetchClients(signal?: AbortSignal): Promise<ListClientsResponse> {
  const response = await fetch("/api/clients", {
    method: "GET",
    cache: "no-store",
    signal: signal ?? null,
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new ClientsApiError(getApiErrorMessage(response, payload), response.status);
  }

  return listClientsResponseSchema.parse(payload);
}

export async function createClientRequest(input: CreateClientRequest): Promise<ClientSummary> {
  const response = await fetch("/api/clients", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(createClientRequestSchema.parse(input)),
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new ClientsApiError(getApiErrorMessage(response, payload), response.status);
  }

  return clientSummarySchema.parse(payload);
}
