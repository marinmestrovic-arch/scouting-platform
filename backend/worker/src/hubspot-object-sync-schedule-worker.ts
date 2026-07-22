import process from "node:process";

import { parseJobPayload } from "@scouting-platform/contracts";
import { createScheduledHubspotObjectSyncRun } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";

import type { WorkerJobOptions } from "./runtime-config";

type HubspotObjectSyncScheduleJob = {
  data: unknown;
};

export const HUBSPOT_OBJECT_SYNC_DAILY_SCHEDULE = {
  name: "hubspot.object-sync.schedule",
  cron: "0 0 * * *",
  timezone: "Europe/Zagreb",
  key: "daily-midnight-europe-zagreb",
} as const;

export const hubspotObjectSyncScheduleWorkerOptions: WorkerJobOptions = {
  localConcurrency: 1,
  batchSize: 1,
};

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

export async function ensureHubspotObjectSyncDailySchedule(
  boss: Pick<PgBoss, "schedule">,
): Promise<void> {
  await boss.schedule(
    HUBSPOT_OBJECT_SYNC_DAILY_SCHEDULE.name,
    HUBSPOT_OBJECT_SYNC_DAILY_SCHEDULE.cron,
    {
      initiatedBy: "system",
    },
    {
      key: HUBSPOT_OBJECT_SYNC_DAILY_SCHEDULE.key,
      tz: HUBSPOT_OBJECT_SYNC_DAILY_SCHEDULE.timezone,
      retryLimit: 2,
      retryDelay: 300,
      retryBackoff: true,
      singletonKey: HUBSPOT_OBJECT_SYNC_DAILY_SCHEDULE.key,
      singletonSeconds: 60 * 60,
    },
  );
}

export async function registerHubspotObjectSyncScheduleWorker(
  boss: Pick<PgBoss, "work">,
  options: WorkerJobOptions = hubspotObjectSyncScheduleWorkerOptions,
): Promise<void> {
  await boss.work(
    HUBSPOT_OBJECT_SYNC_DAILY_SCHEDULE.name,
    options,
    async (job: HubspotObjectSyncScheduleJob | HubspotObjectSyncScheduleJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        parseJobPayload("hubspot.object-sync.schedule", current.data);

        try {
          const run = await createScheduledHubspotObjectSyncRun();
          process.stdout.write(
            `[worker] scheduled HubSpot object sync queued as ${run.id}\n`,
          );
        } catch (error) {
          process.stderr.write(
            `[worker] hubspot.object-sync.schedule failed: ${formatErrorMessage(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}
