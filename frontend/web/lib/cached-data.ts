import { unstable_cache } from "next/cache";
import type { ListChannelsInput } from "@scouting-platform/core";
import {
  listCampaigns,
  listClients,
  listDropdownValues,
  listRecentRuns,
  listCampaignManagers,
  listChannels,
  listHubspotObjectSyncRuns,
  listUserSegments,
  getChannelById,
  listUsers,
} from "@scouting-platform/core";

/**
 * Cross-request data cache wrappers using Next.js `unstable_cache`.
 *
 * `React.cache()` deduplicates within a single request.
 * `unstable_cache` persists results across requests for the given TTL,
 * eliminating redundant DB round-trips when multiple users (or the same
 * user on successive navigations) hit the same data.
 *
 * Tier 1 — global, rarely changing data  → 5 min
 * Tier 2 — user-scoped, mutation-driven  → 60 s
 * Tier 3 — status-sensitive, polled       → 30 s
 */

// ---------------------------------------------------------------------------
// Tier 1 – Global, rarely changing (5 min)
// ---------------------------------------------------------------------------

export const getCachedDropdownValues = unstable_cache(
  () => listDropdownValues(),
  ["dropdown-values"],
  { revalidate: 300 },
);

export const getCachedCampaignManagers = unstable_cache(
  () => listCampaignManagers(),
  ["campaign-managers"],
  { revalidate: 300 },
);

// ---------------------------------------------------------------------------
// Tier 2 – User-scoped, mutation-driven (60 s)
// ---------------------------------------------------------------------------

export function getCachedCampaigns(
  userId: string,
  query?: { active?: boolean },
) {
  return unstable_cache(
    () => listCampaigns({ userId, ...(query ? { query } : {}) }),
    ["campaigns", userId, JSON.stringify(query ?? {})],
    { revalidate: 60 },
  )();
}

export function getCachedClients(
  userId: string,
  query?: { active?: boolean },
) {
  return unstable_cache(
    () => listClients({ userId, ...(query ? { query } : {}) }),
    ["clients", userId, JSON.stringify(query ?? {})],
    { revalidate: 60 },
  )();
}

export function getCachedUserSegments(userId: string) {
  return unstable_cache(
    () => listUserSegments(userId),
    ["segments", userId],
    { revalidate: 60 },
  )();
}

// ---------------------------------------------------------------------------
// Tier 3 – Status-sensitive, polled (30 s)
// ---------------------------------------------------------------------------

export function getCachedRecentRuns(input: {
  userId: string;
  role: "admin" | "user";
  limit?: number;
}) {
  return unstable_cache(
    () => listRecentRuns(input),
    ["recent-runs", input.userId, input.role, String(input.limit ?? 50)],
    { revalidate: 30 },
  )();
}

export function getCachedChannels(input: ListChannelsInput) {
  return unstable_cache(
    () => listChannels(input),
    [
      "channels",
      String(input.page),
      String(input.pageSize),
      input.query ?? "",
      JSON.stringify(input.countryRegion ?? []),
      JSON.stringify(input.influencerVertical ?? []),
      JSON.stringify(input.influencerType ?? []),
      String(input.youtubeVideoMedianViewsMin ?? ""),
      String(input.youtubeVideoMedianViewsMax ?? ""),
      String(input.youtubeShortsMedianViewsMin ?? ""),
      String(input.youtubeShortsMedianViewsMax ?? ""),
      String(input.youtubeFollowersMin ?? ""),
      String(input.youtubeFollowersMax ?? ""),
      JSON.stringify(input.enrichmentStatus ?? []),
      JSON.stringify(input.advancedReportStatus ?? []),
    ],
    { revalidate: 30 },
  )();
}

export function getCachedChannelById(id: string) {
  return unstable_cache(
    () => getChannelById(id),
    ["channel", id],
    { revalidate: 30 },
  )();
}

export const getCachedUsers = unstable_cache(
  () => listUsers(),
  ["users"],
  { revalidate: 60 },
);

export function getCachedHubspotObjectSyncRuns(userId: string) {
  return unstable_cache(
    () => listHubspotObjectSyncRuns({ requestedByUserId: userId }),
    ["hubspot-object-sync-runs", userId],
    { revalidate: 30 },
  )();
}
