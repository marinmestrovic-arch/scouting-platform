import type {
  CsvExportBatchSummary,
  HubspotImportBatchSummary,
  RunStatusResponse,
} from "@scouting-platform/contracts";

import { createCsvExportBatch } from "./csv-export-batches-api";
import {
  createHubspotImportBatch,
  HubspotImportBatchesApiError,
} from "./hubspot-import-batches-api";
import { fetchRunStatus } from "./runs-api";

export class RunBatchActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunBatchActionError";
  }
}

function formatHubspotValidationError(error: HubspotImportBatchesApiError): string {
  const blockers = error.validation?.blockers ?? [];

  if (blockers.length === 0) {
    return error.message;
  }

  const summary = blockers
    .slice(0, 3)
    .map((blocker) => blocker.message)
    .join(" ");
  const remaining = blockers.length - 3;

  return remaining > 0
    ? `${summary} ${remaining} more blocker${remaining === 1 ? "" : "s"} remain.`
    : summary;
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
): Promise<HubspotImportBatchSummary> {
  const channelIds = await getRunChannelIds(runId);

  if (channelIds.length === 0) {
    throw new RunBatchActionError(
      "This run does not have saved creators yet. Wait for results before creating a HubSpot import batch.",
    );
  }

  try {
    return await createHubspotImportBatch({
      runId,
    });
  } catch (error) {
    if (error instanceof HubspotImportBatchesApiError) {
      throw new RunBatchActionError(formatHubspotValidationError(error));
    }

    throw error;
  }
}
