import { enqueueJob, stopQueueRuntime } from "../queue";

export async function enqueueRunsDiscoverJob(payload: {
  runRequestId: string;
  requestedByUserId: string;
}): Promise<void> {
  await enqueueJob("runs.discover", payload);
}

export async function stopRunsQueue(): Promise<void> {
  await stopQueueRuntime();
}
