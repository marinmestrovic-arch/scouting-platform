import process from "node:process";

import {
  recoverStaleHubspotDeliveries,
} from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";

export type HubspotDeliveryRecoveryMonitor = Readonly<{
  runOnce: () => Promise<void>;
  stop: () => void;
}>;

export const HUBSPOT_DELIVERY_RECOVERY_INTERVAL_MS = 30 * 1_000;
export const HUBSPOT_DELIVERY_RECOVERY_INITIAL_DELAY_MS = 10 * 1_000;

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export function startHubspotDeliveryRecoveryMonitor(
  boss: Pick<PgBoss, "send">,
): HubspotDeliveryRecoveryMonitor {
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    if (stopped || inFlight) {
      return;
    }

    inFlight = (async () => {
      try {
        const result = await recoverStaleHubspotDeliveries({
          enqueueImport: async (payload, options) => {
            await boss.send("hubspot.import.batch", payload, {
              retryLimit: 5,
              retryDelay: 30,
              retryBackoff: true,
              startAfter: options.startAfterSeconds,
            });
          },
          enqueuePush: async (payload, options) => {
            await boss.send("hubspot.push.batch", payload, {
              retryLimit: 5,
              retryDelay: 30,
              retryBackoff: true,
              startAfter: options.startAfterSeconds,
            });
          },
        });

        const claimed = result.directImports.claimed
          + result.csvFallbackImports.claimed
          + result.legacyPushes.claimed;
        const requeued = result.directImports.requeued
          + result.csvFallbackImports.requeued
          + result.legacyPushes.requeued;
        const enqueueFailed = result.directImports.enqueueFailed
          + result.csvFallbackImports.enqueueFailed
          + result.legacyPushes.enqueueFailed;
        const ownershipLost = result.directImports.ownershipLost
          + result.csvFallbackImports.ownershipLost
          + result.legacyPushes.ownershipLost;
        if (
          requeued > 0
          || enqueueFailed > 0
          || ownershipLost > 0
        ) {
          process.stdout.write(
            `[worker] hubspot delivery recovery claimed=${claimed} requeued=${requeued} enqueueFailed=${enqueueFailed} ownershipLost=${ownershipLost}\n`,
          );
        }
      } catch (error) {
        process.stderr.write(
          `[worker] hubspot delivery recovery failed: ${formatError(error)}\n`,
        );
      } finally {
        inFlight = null;
      }
    })();

    await inFlight;
  };

  const initialTimer = setTimeout(() => {
    void runOnce();
  }, HUBSPOT_DELIVERY_RECOVERY_INITIAL_DELAY_MS);
  const intervalTimer = setInterval(() => {
    void runOnce();
  }, HUBSPOT_DELIVERY_RECOVERY_INTERVAL_MS);
  initialTimer.unref();
  intervalTimer.unref();

  return {
    runOnce,
    stop: () => {
      stopped = true;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    },
  };
}
