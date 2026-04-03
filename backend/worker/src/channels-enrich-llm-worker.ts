import process from "node:process";

import type { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeChannelLlmEnrichment } from "@scouting-platform/core";

import type { WorkerJobOptions } from "./runtime-config";

type ChannelsEnrichLlmJob = {
  data: unknown;
};

export const channelsEnrichLlmWorkerOptions: WorkerJobOptions = {
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

export async function registerChannelsEnrichLlmWorker(
  boss: Pick<PgBoss, "work">,
  options: WorkerJobOptions = channelsEnrichLlmWorkerOptions,
): Promise<void> {
  await boss.work(
    "channels.enrich.llm",
    options,
    async (job: ChannelsEnrichLlmJob | ChannelsEnrichLlmJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload("channels.enrich.llm", current.data);

        try {
          await executeChannelLlmEnrichment(payload);
        } catch (error) {
          process.stderr.write(
            `[worker] channels.enrich.llm failed for ${payload.channelId}: ${formatErrorMessage(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
