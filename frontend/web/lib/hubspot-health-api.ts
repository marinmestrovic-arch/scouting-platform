import {
  hubspotHealthStateSchema,
  type HubspotHealthState,
} from "@scouting-platform/contracts";

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readError(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return fallback;
}

async function requestHealth(
  method: "GET" | "POST",
  signal?: AbortSignal,
): Promise<HubspotHealthState> {
  const response = await fetch("/api/database/hubspot-health", {
    method,
    cache: "no-store",
    signal: signal ?? null,
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new Error(readError(payload, "Unable to load HubSpot connection health."));
  }

  const parsed = hubspotHealthStateSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error("Received an invalid HubSpot connection health response.");
  }

  return parsed.data;
}

export function fetchHubspotHealth(signal?: AbortSignal): Promise<HubspotHealthState> {
  return requestHealth("GET", signal);
}

export function requestHubspotHealthCheck(): Promise<HubspotHealthState> {
  return requestHealth("POST");
}
