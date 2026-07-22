import { recoverHubspotHealthCheckRuns } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@scouting-platform/core", () => ({
  HUBSPOT_HEALTH_QUEUE_RECOVERY_AFTER_MS: 30_000,
  HUBSPOT_HEALTH_RECOVERY_BATCH_SIZE: 25,
  HUBSPOT_HEALTH_RUNNING_TIMEOUT_MS: 900_000,
  recoverHubspotHealthCheckRuns: vi.fn(),
}));

import { startHubspotHealthCheckRecoveryMonitor } from "./hubspot-health-check-recovery-monitor";

const payload = {
  healthCheckRunId: "11111111-1111-4111-8111-111111111111",
  requestedByUserId: "22222222-2222-4222-8222-222222222222",
};

describe("HubSpot health-check recovery monitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-enqueues persisted work with a per-run queue singleton", async () => {
    const send = vi.fn().mockResolvedValue("job-id");
    vi.mocked(recoverHubspotHealthCheckRuns).mockImplementationOnce(async (input) => {
      await input.enqueue(payload);
      return { requeued: 1, enqueueFailed: 0, timedOut: 0 };
    });
    const monitor = startHubspotHealthCheckRecoveryMonitor({
      send,
    } as unknown as Pick<PgBoss, "send">);

    await monitor.runOnce();
    monitor.stop();

    expect(send).toHaveBeenCalledWith(
      "hubspot.health-check",
      payload,
      expect.objectContaining({
        retryLimit: 5,
        singletonKey: payload.healthCheckRunId,
        singletonSeconds: 86_400,
      }),
    );
  });
});
