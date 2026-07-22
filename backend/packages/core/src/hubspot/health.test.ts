import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, loadHubspotFeatureFlagsMock } = vi.hoisted(() => ({
  prismaMock: {
    runRequest: { findUnique: vi.fn() },
    hubspotPortal: { findFirst: vi.fn() },
    hubspotImportBatch: { findFirst: vi.fn() },
  },
  loadHubspotFeatureFlagsMock: vi.fn(),
}));

vi.mock("@scouting-platform/db", () => ({
  prisma: prismaMock,
  withDbTransaction: vi.fn(),
}));

vi.mock("@scouting-platform/integrations", async (importOriginal) => {
  const original = await importOriginal<typeof import("@scouting-platform/integrations")>();
  return {
    ...original,
    loadHubspotFeatureFlags: loadHubspotFeatureFlagsMock,
  };
});

import { getHubspotReadiness, summarizeHubspotHealth } from "./health";

const healthyReport = {
  status: "healthy",
  portalId: "12345",
  displayName: "Portal",
  directSyncEnabled: true,
  webhooksEnabled: false,
  checkedAt: "2026-07-20T12:00:00.000Z",
  lastReferenceSyncAt: "2026-07-20T11:00:00.000Z",
  lastObjectSyncAt: "2026-07-20T11:00:00.000Z",
  lastWebhookProcessedAt: null,
  checks: [],
  blockers: [],
  requiredActions: [],
  lastError: null,
} as const;

describe("HubSpot health domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadHubspotFeatureFlagsMock.mockReturnValue({
      directSync: true,
      webhooks: false,
      webhookJournal: false,
      uiExtensions: false,
    });
    prismaMock.runRequest.findUnique.mockResolvedValue({
      requestedByUserId: "22222222-2222-4222-8222-222222222222",
    });
    prismaMock.hubspotPortal.findFirst.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      portalId: "12345",
      displayName: "Portal",
      healthStatus: "HEALTHY",
      healthCheckedAt: new Date(),
      healthLastError: null,
      healthSummary: healthyReport,
      lastReferenceSyncAt: new Date(),
      lastObjectSyncAt: new Date(),
      lastWebhookProcessedAt: null,
    });
    prismaMock.hubspotImportBatch.findFirst.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("classifies failures as blockers and warnings as required actions", () => {
    expect(
      summarizeHubspotHealth([
        { code: "a", label: "A", status: "pass", message: "ok" },
        { code: "b", label: "B", status: "warning", message: "refresh refs" },
      ]),
    ).toEqual({
      status: "degraded",
      blockers: [],
      requiredActions: ["refresh refs"],
    });

    expect(
      summarizeHubspotHealth([
        { code: "c", label: "C", status: "fail", message: "missing property" },
      ]),
    ).toEqual({
      status: "unhealthy",
      blockers: ["missing property"],
      requiredActions: [],
    });

    expect(
      summarizeHubspotHealth([
        { code: "d", label: "D", status: "skipped", message: "optional feature disabled" },
      ]),
    ).toEqual({
      status: "healthy",
      blockers: [],
      requiredActions: [],
    });
  });

  it("returns persisted readiness and the newest caller-visible active direct batch", async () => {
    await expect(
      getHubspotReadiness({
        requestedByUserId: "22222222-2222-4222-8222-222222222222",
        role: "user",
        runId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({
      enabled: true,
      ready: true,
      healthStatus: "healthy",
      portalId: "12345",
      blockers: [],
      activeBatchId: "33333333-3333-4333-8333-333333333333",
    });

    expect(prismaMock.hubspotImportBatch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requestedByUserId: "22222222-2222-4222-8222-222222222222",
          runRequestId: "44444444-4444-4444-8444-444444444444",
        }),
      }),
    );
  });

  it("does not expose another user's run readiness", async () => {
    await expect(
      getHubspotReadiness({
        requestedByUserId: "55555555-5555-4555-8555-555555555555",
        role: "user",
        runId: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toMatchObject({ code: "RUN_FORBIDDEN", status: 403 });

    expect(prismaMock.hubspotPortal.findFirst).not.toHaveBeenCalled();
  });

  it("blocks direct sync when the persisted health check is stale", async () => {
    prismaMock.hubspotPortal.findFirst.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      portalId: "12345",
      displayName: "Portal",
      healthStatus: "HEALTHY",
      healthCheckedAt: new Date(Date.now() - 25 * 60 * 60 * 1_000),
      healthLastError: null,
      healthSummary: healthyReport,
      lastReferenceSyncAt: new Date(),
      lastObjectSyncAt: new Date(),
      lastWebhookProcessedAt: null,
    });

    const readiness = await getHubspotReadiness({
      requestedByUserId: "22222222-2222-4222-8222-222222222222",
      role: "user",
      runId: "44444444-4444-4444-8444-444444444444",
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain(
      "The HubSpot connection health check is stale; an administrator must rerun it",
    );
  });
});
