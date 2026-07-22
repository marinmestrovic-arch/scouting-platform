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
}, options: { startAfterSeconds?: number } = {}): Promise<void> {
  await enqueueJob("hubspot.import.batch", payload, {
    ...(options.startAfterSeconds === undefined
      ? {}
      : { startAfter: options.startAfterSeconds }),
  });
}

export async function enqueueHubspotObjectSyncJob(payload: {
  syncRunId: string;
  requestedByUserId: string;
}): Promise<void> {
  await enqueueJob("hubspot.object-sync", payload);
}

export async function enqueueHubspotHealthCheckJob(payload: {
  healthCheckRunId: string;
  requestedByUserId: string;
}): Promise<void> {
  await enqueueJob("hubspot.health-check", payload, {
    singletonKey: payload.healthCheckRunId,
    singletonSeconds: 24 * 60 * 60,
  });
}

export async function enqueueHubspotWebhookJob(
  payload: { webhookEventId: string },
  options: { startAfterSeconds?: number; deduplicate?: boolean } = {},
): Promise<void> {
  const deduplicate = options.deduplicate ?? true;
  await enqueueJob("hubspot.webhook.process", payload, {
    ...(options.startAfterSeconds === undefined
      ? {}
      : { startAfter: options.startAfterSeconds }),
    ...(deduplicate
      ? {
          singletonKey: payload.webhookEventId,
          singletonSeconds: 60,
        }
      : {}),
  });
}

export async function stopHubspotPushQueue(): Promise<void> {
  await stopQueueRuntime();
}

export async function stopHubspotImportQueue(): Promise<void> {
  await stopQueueRuntime();
}

export async function stopHubspotObjectSyncQueue(): Promise<void> {
  await stopQueueRuntime();
}

export async function stopHubspotHealthCheckQueue(): Promise<void> {
  await stopQueueRuntime();
}

export async function stopHubspotWebhookQueue(): Promise<void> {
  await stopQueueRuntime();
}
