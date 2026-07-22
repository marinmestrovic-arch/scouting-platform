import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  enqueueHubspotHealthCheckJobMock,
  integrationMocks,
  prismaMock,
  transactionMock,
  withDbTransactionMock,
} = vi.hoisted(() => {
  const integrationMocks = {
    fetchHubspotAccountIdentity: vi.fn(),
    fetchHubspotAssociationLabels: vi.fn(),
    fetchHubspotObjectSchemas: vi.fn(),
    fetchHubspotOwners: vi.fn(),
    fetchHubspotPipelines: vi.fn(),
    fetchHubspotProperties: vi.fn(),
    fetchHubspotPropertyDefinition: vi.fn(),
    loadHubspotConfig: vi.fn(),
    loadHubspotFeatureFlags: vi.fn(),
  };
  const prismaMock = {
    user: { findUnique: vi.fn() },
    hubspotPortal: { findFirst: vi.fn() },
    hubspotHealthCheckRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const transactionMock = {
    hubspotPortal: { upsert: vi.fn() },
    hubspotHealthCheckRun: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    auditEvent: { create: vi.fn() },
  };
  const withDbTransactionMock = vi.fn(
    async (callback: (tx: typeof transactionMock) => Promise<unknown>) =>
      callback(transactionMock),
  );

  return {
    enqueueHubspotHealthCheckJobMock: vi.fn(),
    integrationMocks,
    prismaMock,
    transactionMock,
    withDbTransactionMock,
  };
});

vi.mock("@scouting-platform/db", () => ({
  prisma: prismaMock,
  withDbTransaction: withDbTransactionMock,
}));

vi.mock("@scouting-platform/integrations", () => integrationMocks);

vi.mock("../dropdown-values", () => ({
  getHubspotDropdownSources: vi.fn(),
}));

vi.mock("./queue", () => ({
  enqueueHubspotHealthCheckJob: enqueueHubspotHealthCheckJobMock,
}));

import {
  executeHubspotHealthCheckRun,
  recoverHubspotHealthCheckRuns,
  requestHubspotHealthCheck,
} from "./health";

const requestedByUserId = "22222222-2222-4222-8222-222222222222";
const healthCheckRunId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-07-20T12:00:00.000Z");

function runRecord(status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED") {
  return {
    id: healthCheckRunId,
    requestedByUserId,
    status,
    queuedAt: new Date("2026-07-20T11:59:00.000Z"),
    startedAt: status === "QUEUED" ? null : now,
    completedAt:
      status === "COMPLETED" || status === "FAILED" ? now : null,
    lastError: status === "FAILED" ? "worker failed" : null,
  };
}

describe("durable HubSpot health-check jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HUBSPOT_PORTAL_ID", "");
    prismaMock.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    prismaMock.hubspotPortal.findFirst.mockResolvedValue(null);
    prismaMock.hubspotHealthCheckRun.findMany.mockResolvedValue([]);
    prismaMock.hubspotHealthCheckRun.updateMany.mockResolvedValue({ count: 1 });
    integrationMocks.loadHubspotFeatureFlags.mockReturnValue({
      directSync: false,
      webhooks: false,
      webhookJournal: false,
      uiExtensions: false,
    });
    transactionMock.hubspotHealthCheckRun.create.mockResolvedValue({
      id: healthCheckRunId,
    });
    transactionMock.hubspotHealthCheckRun.updateMany.mockResolvedValue({ count: 1 });
    transactionMock.auditEvent.create.mockResolvedValue({ id: "audit-event" });
    enqueueHubspotHealthCheckJobMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("persists queued state and an audit event before enqueueing", async () => {
    prismaMock.hubspotHealthCheckRun.findFirst.mockImplementation(
      async (args: { where?: { status?: string } }) =>
        args.where?.status ? null : runRecord("QUEUED"),
    );

    const state = await requestHubspotHealthCheck({ requestedByUserId });

    expect(state.latestRun).toMatchObject({
      id: healthCheckRunId,
      status: "queued",
      startedAt: null,
      completedAt: null,
      lastError: null,
    });
    expect(transactionMock.hubspotHealthCheckRun.create).toHaveBeenCalledWith({
      data: { requestedByUserId },
      select: { id: true },
    });
    expect(transactionMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: requestedByUserId,
        action: "hubspot_health.requested",
        entityId: healthCheckRunId,
      }),
    });
    expect(enqueueHubspotHealthCheckJobMock).toHaveBeenCalledWith({
      healthCheckRunId,
      requestedByUserId,
    });
  });

  it("persists failed state and lastError when enqueueing fails", async () => {
    enqueueHubspotHealthCheckJobMock.mockRejectedValueOnce(
      new Error("queue unavailable"),
    );

    await expect(requestHubspotHealthCheck({ requestedByUserId })).rejects.toMatchObject({
      code: "HUBSPOT_HEALTH_ENQUEUE_FAILED",
      status: 503,
    });

    expect(transactionMock.hubspotHealthCheckRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: healthCheckRunId,
        status: "QUEUED",
      },
      data: expect.objectContaining({
        status: "FAILED",
        completedAt: expect.any(Date),
        lastError: "Failed to enqueue HubSpot health check: queue unavailable",
      }),
    });
    expect(transactionMock.auditEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        action: "hubspot_health.failed",
        entityId: healthCheckRunId,
      }),
    });
  });

  it("claims, completes, and persists a diagnostic report without live calls in tests", async () => {
    prismaMock.hubspotHealthCheckRun.findUnique
      .mockResolvedValueOnce(runRecord("QUEUED"))
      .mockResolvedValueOnce(runRecord("COMPLETED"));
    prismaMock.hubspotHealthCheckRun.updateMany.mockResolvedValue({ count: 1 });
    integrationMocks.loadHubspotConfig.mockImplementation(() => {
      throw new Error("test configuration is intentionally incomplete");
    });

    const run = await executeHubspotHealthCheckRun({
      healthCheckRunId,
      requestedByUserId,
      now,
    });

    expect(run.status).toBe("completed");
    expect(prismaMock.hubspotHealthCheckRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "RUNNING",
          startedAt: now,
          lastError: null,
        }),
      }),
    );
    expect(transactionMock.hubspotHealthCheckRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: healthCheckRunId,
        requestedByUserId,
        status: "RUNNING",
        leaseOwner: expect.any(String),
      }),
      data: expect.objectContaining({
        status: "COMPLETED",
        report: expect.objectContaining({
          status: "unhealthy",
          checkedAt: now.toISOString(),
        }),
        completedAt: now,
        lastError: null,
      }),
    });
    expect(integrationMocks.fetchHubspotAccountIdentity).not.toHaveBeenCalled();
    expect(integrationMocks.fetchHubspotProperties).not.toHaveBeenCalled();
  });

  it("durably fails a claimed run when its requester is no longer an admin", async () => {
    prismaMock.hubspotHealthCheckRun.findUnique.mockResolvedValueOnce(
      runRecord("QUEUED"),
    );
    prismaMock.hubspotHealthCheckRun.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUnique.mockResolvedValue({ role: "USER" });

    await expect(
      executeHubspotHealthCheckRun({
        healthCheckRunId,
        requestedByUserId,
        now,
      }),
    ).rejects.toMatchObject({ code: "HUBSPOT_HEALTH_FORBIDDEN", status: 403 });

    expect(transactionMock.hubspotHealthCheckRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: healthCheckRunId,
        requestedByUserId,
        leaseOwner: expect.any(String),
        status: { in: ["QUEUED", "RUNNING"] },
      }),
      data: expect.objectContaining({
        status: "FAILED",
        completedAt: now,
        lastError: "Forbidden",
        leaseOwner: null,
        leaseExpiresAt: null,
      }),
    });
    expect(integrationMocks.fetchHubspotAccountIdentity).not.toHaveBeenCalled();
  });

  it("requeues stale queued runs and terminalizes timed-out running work", async () => {
    const staleRunningId = "33333333-3333-4333-8333-333333333333";
    const staleQueuedId = "44444444-4444-4444-8444-444444444444";
    prismaMock.hubspotHealthCheckRun.findMany.mockImplementation(
      async (args: { where: { status: string } }) =>
        args.where.status === "RUNNING"
          ? [{ id: staleRunningId, requestedByUserId }]
          : [{ id: staleQueuedId, requestedByUserId }],
    );
    const enqueue = vi.fn().mockResolvedValue(undefined);

    await expect(
      recoverHubspotHealthCheckRuns({
        enqueue,
        now,
        queuedRecoveryAfterMs: 30_000,
        runningTimeoutMs: 60_000,
      }),
    ).resolves.toEqual({ requeued: 1, enqueueFailed: 0, timedOut: 1 });

    expect(enqueue).toHaveBeenCalledWith({
      healthCheckRunId: staleQueuedId,
      requestedByUserId,
    });
    expect(transactionMock.hubspotHealthCheckRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: staleRunningId, status: "RUNNING" }),
        data: expect.objectContaining({
          status: "FAILED",
          completedAt: now,
          lastError: "HubSpot health check exceeded the worker execution timeout",
        }),
      }),
    );
    expect(transactionMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "hubspot_health.failed",
        entityId: staleRunningId,
      }),
    });
  });

  it("rejects duplicate delivery while a non-stale run is already running", async () => {
    prismaMock.hubspotHealthCheckRun.findUnique.mockResolvedValueOnce(
      runRecord("RUNNING"),
    );

    await expect(
      executeHubspotHealthCheckRun({
        healthCheckRunId,
        requestedByUserId,
        now,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_HEALTH_RUN_ALREADY_RUNNING",
      status: 409,
    });

    expect(prismaMock.hubspotHealthCheckRun.updateMany).not.toHaveBeenCalled();
    expect(integrationMocks.fetchHubspotAccountIdentity).not.toHaveBeenCalled();
  });
});
