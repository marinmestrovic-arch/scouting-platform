import process from "node:process";

import type { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeRunChannelFitAssessment } from "@scouting-platform/core";

import type { WorkerJobOptions } from "./runtime-config";

type RunsAssessChannelFitJob = {
  data: unknown;
  retryCount?: number;
  retryLimit?: number;
};

export const runsAssessChannelFitWorkerOptions: WorkerJobOptions = {
  localConcurrency: 2,
  batchSize: 1,
  includeMetadata: true,
};

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

export async function registerRunsAssessChannelFitWorker(
  boss: Pick<PgBoss, "work">,
  options: WorkerJobOptions = runsAssessChannelFitWorkerOptions,
): Promise<void> {
  const workerOptions: WorkerJobOptions = {
    ...options,
    includeMetadata: true,
  };

  await boss.work(
    "runs.assess.channel-fit",
    workerOptions,
    async (job: RunsAssessChannelFitJob | RunsAssessChannelFitJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload("runs.assess.channel-fit", current.data);

        const isFinalAttempt =
          typeof current.retryCount === "number" &&
          typeof current.retryLimit === "number" &&
          current.retryCount >= current.retryLimit;

        try {
          await executeRunChannelFitAssessment({
            ...payload,
            isFinalAttempt,
          });
        } catch (error) {
          process.stderr.write(
            `[worker] runs.assess.channel-fit failed for run ${payload.runRequestId} channel ${payload.channelId}: ${formatErrorMessage(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
