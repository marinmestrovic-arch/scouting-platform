import process from "node:process";

import type { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeCsvExportBatch } from "@scouting-platform/core";

import type { WorkerJobOptions } from "./runtime-config";

type ExportsCsvGenerateJob = {
  data: unknown;
};

export const exportsCsvGenerateWorkerOptions: WorkerJobOptions = {
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

export async function registerExportsCsvGenerateWorker(
  boss: Pick<PgBoss, "work">,
  options: WorkerJobOptions = exportsCsvGenerateWorkerOptions,
): Promise<void> {
  await boss.work(
    "exports.csv.generate",
    options,
    async (job: ExportsCsvGenerateJob | ExportsCsvGenerateJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload("exports.csv.generate", current.data);

        try {
          await executeCsvExportBatch(payload);
        } catch (error) {
          process.stderr.write(
            `[worker] exports.csv.generate failed for ${payload.exportBatchId}: ${formatErrorMessage(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
