import { enqueueJob, stopQueueRuntime } from "../queue";

export async function enqueueAdvancedReportJob(payload: {
  advancedReportRequestId: string;
  requestedByUserId: string;
}): Promise<void> {
  await enqueueJob("channels.enrich.hypeauditor", payload);
}

export async function stopAdvancedReportsQueue(): Promise<void> {
  await stopQueueRuntime();
}
