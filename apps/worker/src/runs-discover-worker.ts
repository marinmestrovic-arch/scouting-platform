import process from "node:process";

import type { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeRunDiscover } from "@scouting-platform/core";

type RunsDiscoverJob = {
  data: unknown;
};

export const runsDiscoverWorkerOptions = {
  teamSize: 1,
  teamConcurrency: 1,
  batchSize: 1,
} as const;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

export async function registerRunsDiscoverWorker(
  boss: Pick<PgBoss, "work">,
): Promise<void> {
  await boss.work(
    "runs.discover",
    runsDiscoverWorkerOptions,
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
