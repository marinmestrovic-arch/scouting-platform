import process from "node:process";

import type { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeHubspotObjectSyncRun } from "@scouting-platform/core";

import type { WorkerJobOptions } from "./runtime-config";

type HubspotObjectSyncJob = {
  data: unknown;
};

export const hubspotObjectSyncWorkerOptions: WorkerJobOptions = {
  localConcurrency: 1,
  batchSize: 1,
};

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

export async function registerHubspotObjectSyncWorker(
  boss: Pick<PgBoss, "work">,
  options: WorkerJobOptions = hubspotObjectSyncWorkerOptions,
): Promise<void> {
  await boss.work(
    "hubspot.object-sync",
    options,
    async (job: HubspotObjectSyncJob | HubspotObjectSyncJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload("hubspot.object-sync", current.data);

        try {
          await executeHubspotObjectSyncRun(payload);
        } catch (error) {
          process.stderr.write(
            `[worker] hubspot.object-sync failed for ${payload.syncRunId}: ${formatErrorMessage(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
