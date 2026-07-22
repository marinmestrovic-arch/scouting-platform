import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchHubspotConflicts } from "./hubspot-conflicts-api";
import { fetchHubspotHealth, requestHubspotHealthCheck } from "./hubspot-health-api";
import { fetchHubspotReadiness } from "./hubspot-readiness-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const healthReport = {
  status: "degraded",
  portalId: "12345",
  displayName: "Scouting test portal",
  directSyncEnabled: false,
  webhooksEnabled: false,
  checkedAt: "2026-07-20T10:00:00.000Z",
  lastReferenceSyncAt: null,
  lastObjectSyncAt: null,
  lastWebhookProcessedAt: null,
  checks: [
    {
      code: "unique_contact_id",
      label: "Contact unique ID",
      status: "fail",
      message: "Create atlas_contact_id in HubSpot.",
    },
  ],
  blockers: ["Direct sync is disabled."],
  requiredActions: ["Provision the contact unique-ID property."],
  lastError: null,
  latestRun: null,
};

describe("HubSpot admin API helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads persisted health state and queues a read-only check", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(healthReport))
      .mockResolvedValueOnce(jsonResponse({ ...healthReport, status: "healthy", blockers: [] }));

    expect((await fetchHubspotHealth()).portalId).toBe("12345");
    expect((await requestHubspotHealthCheck()).status).toBe("healthy");
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/database/hubspot-health",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/database/hubspot-health",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("requests open conflicts by default and validates the response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ items: [] }),
    );

    await expect(fetchHubspotConflicts()).resolves.toEqual([]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/database/hubspot-conflicts?status=open",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("loads user-safe run readiness without calling a provider URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        enabled: false,
        ready: false,
        healthStatus: "unknown",
        portalId: null,
        blockers: ["Direct HubSpot sync is disabled."],
        activeBatchId: null,
      }),
    );

    const readiness = await fetchHubspotReadiness(
      "22222222-2222-4222-8222-222222222222",
    );

    expect(readiness.ready).toBe(false);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/hubspot-readiness?runId=22222222-2222-4222-8222-222222222222",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });
});
