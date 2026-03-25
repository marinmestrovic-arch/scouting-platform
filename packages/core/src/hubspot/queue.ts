import { enqueueJob, stopQueueRuntime } from "../queue";

export async function enqueueHubspotPushJob(payload: {
  pushBatchId: string;
  requestedByUserId: string;
}): Promise<void> {
  await enqueueJob("hubspot.push.batch", payload);
}

export async function enqueueHubspotImportJob(payload: {
  importBatchId: string;
  requestedByUserId: string;
}): Promise<void> {
  await enqueueJob("hubspot.import.batch", payload);
}

export async function stopHubspotPushQueue(): Promise<void> {
  await stopQueueRuntime();
}

export async function stopHubspotImportQueue(): Promise<void> {
  await stopQueueRuntime();
}
