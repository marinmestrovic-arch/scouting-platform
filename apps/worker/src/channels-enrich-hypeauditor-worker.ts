import process from "node:process";

import type { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeAdvancedReportRequest } from "@scouting-platform/core";

type ChannelsEnrichHypeAuditorJob = {
  data: unknown;
};

export const channelsEnrichHypeAuditorWorkerOptions = {
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

export async function registerChannelsEnrichHypeAuditorWorker(
  boss: Pick<PgBoss, "work">,
): Promise<void> {
  await boss.work(
    "channels.enrich.hypeauditor",
    channelsEnrichHypeAuditorWorkerOptions,
    async (job: ChannelsEnrichHypeAuditorJob | ChannelsEnrichHypeAuditorJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload("channels.enrich.hypeauditor", current.data);

        try {
          await executeAdvancedReportRequest(payload);
        } catch (error) {
          process.stderr.write(
            `[worker] channels.enrich.hypeauditor failed for ${payload.advancedReportRequestId}: ${formatErrorMessage(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
