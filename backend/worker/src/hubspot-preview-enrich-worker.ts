import process from "node:process";

import type { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeHubspotPreviewEnrichmentJob } from "@scouting-platform/core";

import type { WorkerJobOptions } from "./runtime-config";

type HubspotPreviewEnrichJob = {
  data: unknown;
};

export const hubspotPreviewEnrichWorkerOptions: WorkerJobOptions = {
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

export async function registerHubspotPreviewEnrichWorker(
  boss: Pick<PgBoss, "work">,
  options: WorkerJobOptions = hubspotPreviewEnrichWorkerOptions,
): Promise<void> {
  await boss.work(
    "hubspot-preview.enrich",
    options,
    async (job: HubspotPreviewEnrichJob | HubspotPreviewEnrichJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload("hubspot-preview.enrich", current.data);

        try {
          await executeHubspotPreviewEnrichmentJob(payload);
        } catch (error) {
          process.stderr.write(
            `[worker] hubspot-preview.enrich failed for ${payload.enrichmentJobId}: ${formatErrorMessage(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
