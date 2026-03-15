import type { CsvExportBatchSummary, HubspotPushBatchSummary, RunStatusResponse } from "@scouting-platform/contracts";

import { createCsvExportBatch } from "./csv-export-batches-api";
import { createHubspotPushBatch } from "./hubspot-push-batches-api";
import { fetchRunStatus } from "./runs-api";

export class RunBatchActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunBatchActionError";
  }
}

export function getRunResultChannelIds(run: Pick<RunStatusResponse, "results">): string[] {
  const ids = new Set<string>();

  for (const result of run.results) {
    ids.add(result.channelId);
  }

  return [...ids];
}

async function getRunChannelIds(runId: string): Promise<string[]> {
  const run = await fetchRunStatus(runId);
  const channelIds = getRunResultChannelIds(run);

  if (channelIds.length === 0) {
    throw new RunBatchActionError(
      "This run does not have saved creators yet. Wait for results before exporting or sending to HubSpot.",
    );
  }

  return channelIds;
}

export async function createCsvExportBatchFromRun(runId: string): Promise<CsvExportBatchSummary> {
  const channelIds = await getRunChannelIds(runId);

  return createCsvExportBatch({
    type: "selected",
    channelIds,
  });
}

export async function createHubspotPushBatchFromRun(
  runId: string,
): Promise<HubspotPushBatchSummary> {
  const channelIds = await getRunChannelIds(runId);

  return createHubspotPushBatch({
    channelIds,
  });
}
