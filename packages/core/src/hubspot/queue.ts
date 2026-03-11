import { enqueueJob, stopQueueRuntime } from "../queue";

export async function enqueueHubspotPushJob(payload: {
  pushBatchId: string;
  requestedByUserId: string;
}): Promise<void> {
  await enqueueJob("hubspot.push.batch", payload);
}

export async function stopHubspotPushQueue(): Promise<void> {
  await stopQueueRuntime();
}
