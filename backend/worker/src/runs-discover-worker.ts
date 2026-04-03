import process from "node:process";

import type { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeRunDiscover } from "@scouting-platform/core";

import type { WorkerJobOptions } from "./runtime-config";

type RunsDiscoverJob = {
  data: unknown;
};

export const runsDiscoverWorkerOptions: WorkerJobOptions = {
  teamSize: 1,
  teamConcurrency: 2,
  batchSize: 1,
};

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

export async function registerRunsDiscoverWorker(
  boss: Pick<PgBoss, "work">,
  options: WorkerJobOptions = runsDiscoverWorkerOptions,
): Promise<void> {
  await boss.work(
    "runs.discover",
    options,
    async (job: RunsDiscoverJob | RunsDiscoverJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload("runs.discover", current.data);

        try {
          await executeRunDiscover(payload);
        } catch (error) {
          process.stderr.write(
            `[worker] runs.discover failed for ${payload.runRequestId}: ${formatErrorMessage(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
