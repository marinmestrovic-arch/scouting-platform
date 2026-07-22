import process from "node:process";

import { parseJobPayload } from "@scouting-platform/contracts";
import { processHubspotWebhookEvent } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";

import type { WorkerJobOptions } from "./runtime-config";

type HubspotWebhookJob = { data: unknown };

export const hubspotWebhookWorkerOptions: WorkerJobOptions = {
  // Core processing takes a transaction-scoped advisory lock per portal,
  // object type, and object ID. This preserves per-object ordering while two
  // unrelated HubSpot objects can still be reconciled in parallel.
  localConcurrency: 2,
  batchSize: 1,
};

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export async function registerHubspotWebhookWorker(
  boss: Pick<PgBoss, "work">,
  options: WorkerJobOptions = hubspotWebhookWorkerOptions,
): Promise<void> {
  await boss.work(
    "hubspot.webhook.process",
    options,
    async (job: HubspotWebhookJob | HubspotWebhookJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload("hubspot.webhook.process", current.data);
        try {
          await processHubspotWebhookEvent(payload);
        } catch (error) {
          process.stderr.write(
            `[worker] hubspot.webhook.process failed for ${payload.webhookEventId}: ${formatError(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
