import {
  hubspotConflictStatusSchema,
  listHubspotConflictsResponseSchema,
  type HubspotConflict,
} from "@scouting-platform/contracts";

export type HubspotConflictFilter = "all" | HubspotConflict["status"];

export async function fetchHubspotConflicts(
  status: HubspotConflictFilter = "open",
  signal?: AbortSignal,
): Promise<HubspotConflict[]> {
  const validatedStatus = status === "all" ? "all" : hubspotConflictStatusSchema.parse(status);
  const params = new URLSearchParams({ status: validatedStatus });
  const response = await fetch(`/api/database/hubspot-conflicts?${params.toString()}`, {
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
    const error =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Unable to load HubSpot conflicts.";
    throw new Error(error);
  }

  const parsed = listHubspotConflictsResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error("Received an invalid HubSpot conflict response.");
  }

  return parsed.data.items;
}
