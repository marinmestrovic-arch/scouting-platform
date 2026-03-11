import process from "node:process";

import type { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeHubspotPushBatch } from "@scouting-platform/core";

type HubspotPushBatchJob = {
  data: unknown;
};

export const hubspotPushBatchWorkerOptions = {
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

export async function registerHubspotPushBatchWorker(
  boss: Pick<PgBoss, "work">,
): Promise<void> {
  await boss.work(
    "hubspot.push.batch",
    hubspotPushBatchWorkerOptions,
    async (job: HubspotPushBatchJob | HubspotPushBatchJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload("hubspot.push.batch", current.data);

        try {
          await executeHubspotPushBatch(payload);
        } catch (error) {
          process.stderr.write(
            `[worker] hubspot.push.batch failed for ${payload.pushBatchId}: ${formatErrorMessage(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
