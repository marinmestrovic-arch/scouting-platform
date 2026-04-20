import {
  HUBSPOT_SYNCED_DROPDOWN_FIELD_KEYS,
  listDropdownValuesResponseSchema,
  syncHubspotDropdownValuesResponseSchema,
  type DropdownValue,
  type DropdownValueFieldKey,
  type UpdateDropdownValuesRequest,
  updateDropdownValuesRequestSchema,
} from "@scouting-platform/contracts";

const HUBSPOT_SYNCED_DROPDOWN_FIELD_SET = new Set<string>(HUBSPOT_SYNCED_DROPDOWN_FIELD_KEYS);

type ApiErrorBody = {
  error?: string;
};

export class DropdownValuesApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DropdownValuesApiError";
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
    return "You are not authorized to manage dropdown values.";
  }

  return "Unable to complete the request. Please try again.";
}

export async function fetchDropdownValues(signal?: AbortSignal): Promise<DropdownValue[]> {
  const response = await fetch("/api/admin/dropdown-values", {
    method: "GET",
    cache: "no-store",
    signal: signal ?? null,
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new DropdownValuesApiError(getApiErrorMessage(response, payload), response.status);
  }

  return listDropdownValuesResponseSchema.parse(payload).items;
}

export async function replaceDropdownValuesRequest(input: UpdateDropdownValuesRequest): Promise<DropdownValue[]> {
  const response = await fetch("/api/admin/dropdown-values", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(updateDropdownValuesRequestSchema.parse(input)),
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new DropdownValuesApiError(getApiErrorMessage(response, payload), response.status);
  }

  return listDropdownValuesResponseSchema.parse(payload).items;
}

export async function syncHubspotDropdownValuesRequest(): Promise<DropdownValue[]> {
  const response = await fetch("/api/admin/dropdown-values", {
    method: "POST",
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new DropdownValuesApiError(getApiErrorMessage(response, payload), response.status);
  }

  return syncHubspotDropdownValuesResponseSchema.parse(payload).items;
}

export function groupDropdownValuesByField(items: DropdownValue[]): Record<DropdownValueFieldKey, string[]> {
  return {
    currency: items.filter((item) => item.fieldKey === "currency").map((item) => item.value),
    dealType: items.filter((item) => item.fieldKey === "dealType").map((item) => item.value),
    activationType: items.filter((item) => item.fieldKey === "activationType").map((item) => item.value),
    influencerType: items.filter((item) => item.fieldKey === "influencerType").map((item) => item.value),
    influencerVertical: items.filter((item) => item.fieldKey === "influencerVertical").map((item) => item.value),
    countryRegion: items.filter((item) => item.fieldKey === "countryRegion").map((item) => item.value),
    language: items.filter((item) => item.fieldKey === "language").map((item) => item.value),
  };
}

export function isHubspotSyncedDropdownField(fieldKey: DropdownValueFieldKey): boolean {
  return HUBSPOT_SYNCED_DROPDOWN_FIELD_SET.has(fieldKey);
}
