import process from "node:process";

import type { PgBoss } from "pg-boss";

import { queueDueChannelLlmEnrichments } from "@scouting-platform/core";

export type ContinuousEnrichmentMonitorOptions = Readonly<{
  enabled: boolean;
  intervalMs: number;
  initialDelayMs: number;
  batchSize: number;
  staleAfterDays: number;
  maxRetryCount: number;
  processingTimeoutMs: number;
  queuedTimeoutMs: number;
}>;

export type ContinuousEnrichmentMonitor = Readonly<{
  runOnce: () => Promise<void>;
  stop: () => void;
}>;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

export function startContinuousEnrichmentMonitor(
  boss: Pick<PgBoss, "send">,
  options: ContinuousEnrichmentMonitorOptions,
): ContinuousEnrichmentMonitor {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let reportedMissingYoutubeCredential = false;
  let initialTimer: NodeJS.Timeout | null = null;
  let intervalTimer: NodeJS.Timeout | null = null;

  const runOnce = async (): Promise<void> => {
    if (stopped || inFlight) {
      return;
    }

    inFlight = (async () => {
      try {
        const result = await queueDueChannelLlmEnrichments({
          batchSize: options.batchSize,
          staleAfterDays: options.staleAfterDays,
          maxRetryCount: options.maxRetryCount,
          processingTimeoutMs: options.processingTimeoutMs,
          queuedTimeoutMs: options.queuedTimeoutMs,
          enqueue: async (payload) => {
            await boss.send("channels.enrich.llm", payload, {
              retryLimit: 5,
              retryDelay: 30,
              retryBackoff: true,
            });
          },
        });

        if (result.missingYoutubeCredential) {
          if (!reportedMissingYoutubeCredential) {
            reportedMissingYoutubeCredential = true;
            process.stderr.write(
              "[worker] continuous enrichment paused: no YouTube credential is available\n",
            );
          }
          return;
        }

        reportedMissingYoutubeCredential = false;

        if (result.queued > 0 || result.failed > 0) {
          process.stdout.write(
            `[worker] continuous enrichment scan queued=${result.queued} failed=${result.failed} skipped=${result.skipped}\n`,
          );
        }
      } catch (error) {
        process.stderr.write(
          `[worker] continuous enrichment scan failed: ${formatErrorMessage(error)}\n`,
        );
      } finally {
        inFlight = null;
      }
    })();

    await inFlight;
  };

  if (options.enabled) {
    process.stdout.write(
      `[worker] continuous enrichment monitor enabled intervalMs=${options.intervalMs} batchSize=${options.batchSize} maxRetryCount=${options.maxRetryCount}\n`,
    );
    initialTimer = setTimeout(() => {
      void runOnce();
    }, options.initialDelayMs);
    intervalTimer = setInterval(() => {
      void runOnce();
    }, options.intervalMs);
    initialTimer.unref();
    intervalTimer.unref();
  } else {
    process.stdout.write("[worker] continuous enrichment monitor disabled\n");
  }

  return {
    runOnce,
    stop: () => {
      stopped = true;

      if (initialTimer) {
        clearTimeout(initialTimer);
      }

      if (intervalTimer) {
        clearInterval(intervalTimer);
      }
    },
  };
}
