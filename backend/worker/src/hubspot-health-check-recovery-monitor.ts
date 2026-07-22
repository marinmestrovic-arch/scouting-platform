import process from "node:process";

import {
  HUBSPOT_HEALTH_QUEUE_RECOVERY_AFTER_MS,
  HUBSPOT_HEALTH_RECOVERY_BATCH_SIZE,
  HUBSPOT_HEALTH_RUNNING_TIMEOUT_MS,
  recoverHubspotHealthCheckRuns,
} from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";

export type HubspotHealthCheckRecoveryMonitor = Readonly<{
  runOnce: () => Promise<void>;
  stop: () => void;
}>;

export const HUBSPOT_HEALTH_RECOVERY_INTERVAL_MS = 30 * 1_000;
export const HUBSPOT_HEALTH_RECOVERY_INITIAL_DELAY_MS = 5 * 1_000;

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export function startHubspotHealthCheckRecoveryMonitor(
  boss: Pick<PgBoss, "send">,
): HubspotHealthCheckRecoveryMonitor {
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    if (stopped || inFlight) {
      return;
    }

    inFlight = (async () => {
      try {
        const result = await recoverHubspotHealthCheckRuns({
          queuedRecoveryAfterMs: HUBSPOT_HEALTH_QUEUE_RECOVERY_AFTER_MS,
          runningTimeoutMs: HUBSPOT_HEALTH_RUNNING_TIMEOUT_MS,
          batchSize: HUBSPOT_HEALTH_RECOVERY_BATCH_SIZE,
          enqueue: async (payload) => {
            await boss.send("hubspot.health-check", payload, {
              retryLimit: 5,
              retryDelay: 30,
              retryBackoff: true,
              singletonKey: payload.healthCheckRunId,
              singletonSeconds: 24 * 60 * 60,
            });
          },
        });

        if (result.requeued > 0 || result.enqueueFailed > 0 || result.timedOut > 0) {
          process.stdout.write(
            `[worker] hubspot health recovery requeued=${result.requeued} enqueueFailed=${result.enqueueFailed} timedOut=${result.timedOut}\n`,
          );
        }
      } catch (error) {
        process.stderr.write(
          `[worker] hubspot health recovery failed: ${formatError(error)}\n`,
        );
      } finally {
        inFlight = null;
      }
    })();

    await inFlight;
  };

  const initialTimer = setTimeout(() => {
    void runOnce();
  }, HUBSPOT_HEALTH_RECOVERY_INITIAL_DELAY_MS);
  const intervalTimer = setInterval(() => {
    void runOnce();
  }, HUBSPOT_HEALTH_RECOVERY_INTERVAL_MS);
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
