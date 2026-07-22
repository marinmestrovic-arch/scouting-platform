import process from "node:process";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeHubspotHealthCheckRun } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";

import type { WorkerJobOptions } from "./runtime-config";

type HubspotHealthCheckJob = { data: unknown };

export const hubspotHealthCheckWorkerOptions: WorkerJobOptions = {
  localConcurrency: 1,
  batchSize: 1,
};

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export async function registerHubspotHealthCheckWorker(
  boss: Pick<PgBoss, "work">,
  options: WorkerJobOptions = hubspotHealthCheckWorkerOptions,
): Promise<void> {
  await boss.work(
    "hubspot.health-check",
    options,
    async (job: HubspotHealthCheckJob | HubspotHealthCheckJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload("hubspot.health-check", current.data);

        try {
          await executeHubspotHealthCheckRun(payload);
        } catch (error) {
          process.stderr.write(
            `[worker] hubspot.health-check failed for ${payload.healthCheckRunId}: ${formatError(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
