import process from "node:process";

import type { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeHubspotImportBatch } from "@scouting-platform/core";

import type { WorkerJobOptions } from "./runtime-config";

type HubspotImportBatchJob = {
  data: unknown;
};

export const hubspotImportBatchWorkerOptions: WorkerJobOptions = {
  teamSize: 1,
  teamConcurrency: 1,
  batchSize: 1,
};

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

export async function registerHubspotImportBatchWorker(
  boss: Pick<PgBoss, "work">,
  options: WorkerJobOptions = hubspotImportBatchWorkerOptions,
): Promise<void> {
  await boss.work(
    "hubspot.import.batch",
    options,
    async (job: HubspotImportBatchJob | HubspotImportBatchJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload("hubspot.import.batch", current.data);

        try {
          await executeHubspotImportBatch(payload);
        } catch (error) {
          process.stderr.write(
            `[worker] hubspot.import.batch failed for ${payload.importBatchId}: ${formatErrorMessage(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
