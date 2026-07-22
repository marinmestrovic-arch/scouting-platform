import { recoverStaleHubspotDeliveries } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@scouting-platform/core", () => ({
  recoverStaleHubspotDeliveries: vi.fn(),
}));

import { startHubspotDeliveryRecoveryMonitor } from "./hubspot-delivery-recovery-monitor";

const importPayload = {
  importBatchId: "11111111-1111-4111-8111-111111111111",
  requestedByUserId: "22222222-2222-4222-8222-222222222222",
};

const pushPayload = {
  pushBatchId: "33333333-3333-4333-8333-333333333333",
  requestedByUserId: "44444444-4444-4444-8444-444444444444",
};

const emptyStats = {
  candidates: 0,
  claimed: 0,
  requeued: 0,
  enqueueFailed: 0,
  ownershipLost: 0,
};

const emptyResult = {
  directImports: emptyStats,
  csvFallbackImports: emptyStats,
  legacyPushes: emptyStats,
};

describe("HubSpot delivery recovery monitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-enqueues recovered import and legacy push batches with delayed retries", async () => {
    const send = vi.fn().mockResolvedValue("job-id");
    vi.mocked(recoverStaleHubspotDeliveries).mockImplementationOnce(
      async (input) => {
        await input.enqueueImport(importPayload, { startAfterSeconds: 2 });
        await input.enqueuePush(pushPayload, { startAfterSeconds: 2 });
        return {
          ...emptyResult,
          directImports: { ...emptyStats, candidates: 1, claimed: 1, requeued: 1 },
          legacyPushes: { ...emptyStats, candidates: 1, claimed: 1, requeued: 1 },
        };
      },
    );
    const monitor = startHubspotDeliveryRecoveryMonitor({
      send,
    } as unknown as Pick<PgBoss, "send">);

    await monitor.runOnce();
    monitor.stop();

    expect(send).toHaveBeenCalledWith(
      "hubspot.import.batch",
      importPayload,
      {
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        startAfter: 2,
      },
    );
    expect(send).toHaveBeenCalledWith(
      "hubspot.push.batch",
      pushPayload,
      {
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        startAfter: 2,
      },
    );
    expect(recoverStaleHubspotDeliveries).toHaveBeenCalledWith(
      {
        enqueueImport: expect.any(Function),
        enqueuePush: expect.any(Function),
      },
    );
  });

  it("does not overlap recovery scans or run again after stop", async () => {
    let finishRecovery: ((result: typeof emptyResult) => void) | undefined;
    vi.mocked(recoverStaleHubspotDeliveries).mockImplementationOnce(
      () => new Promise((resolve) => {
        finishRecovery = resolve;
      }),
    );
    const monitor = startHubspotDeliveryRecoveryMonitor({
      send: vi.fn(),
    } as unknown as Pick<PgBoss, "send">);

    const firstRun = monitor.runOnce();
    await monitor.runOnce();
    expect(recoverStaleHubspotDeliveries).toHaveBeenCalledTimes(1);

    finishRecovery?.(emptyResult);
    await firstRun;
    monitor.stop();
    await monitor.runOnce();

    expect(recoverStaleHubspotDeliveries).toHaveBeenCalledTimes(1);
  });
});
