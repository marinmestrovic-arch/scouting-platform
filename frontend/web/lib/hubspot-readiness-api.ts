import {
  hubspotReadinessSchema,
  type HubspotReadiness,
} from "@scouting-platform/contracts";

export async function fetchHubspotReadiness(
  runId: string,
  signal?: AbortSignal,
): Promise<HubspotReadiness> {
  const params = new URLSearchParams({ runId });
  const response = await fetch(`/api/hubspot-readiness?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    signal: signal ?? null,
  });
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Unable to check HubSpot readiness.";
    throw new Error(message);
  }

  const parsed = hubspotReadinessSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error("Received an invalid HubSpot readiness response.");
  }

  return parsed.data;
}
