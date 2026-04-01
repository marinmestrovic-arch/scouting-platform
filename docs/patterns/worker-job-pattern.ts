// @ts-nocheck
/**
 * Worker Job Pattern
 *
 * This pattern mirrors the workers in backend/worker/src/.
 * Copy and adapt it for new pg-boss handlers.
 *
 * Requirements enforced:
 * 1. Job name + payload schema live in shared/packages/contracts
 * 2. Worker parses payload with parseJobPayload()
 * 3. Worker stays thin and delegates stateful work to @scouting-platform/core
 * 4. Concurrency caps are explicit in worker options
 * 5. Failures are logged and re-thrown for pg-boss retry handling
 *
 * Example location:
 * backend/worker/src/channels-enrich-llm-worker.ts
 */

import process from "node:process";

import type { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";
import { executeChannelLlmEnrichment } from "@scouting-platform/core";

type ChannelsEnrichLlmJob = {
  data: unknown;
};

// ============================================================================
// 1. JOB NAME
// Keep this in sync with shared/packages/contracts/src/jobs.ts.
// ============================================================================

export const JOB_NAME = "channels.enrich.llm";

// ============================================================================
// 2. WORKER OPTIONS
// Always set explicit concurrency.
// ============================================================================

export const channelsEnrichLlmWorkerOptions = {
  teamSize: 1,
  teamConcurrency: 2,
  batchSize: 1,
} as const;

// ============================================================================
// 3. ERROR FORMATTING
// Keep worker logs operator-friendly.
// ============================================================================

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

// ============================================================================
// 4. REGISTRATION
// Parse payload, delegate to core, log failures, re-throw for retries.
// ============================================================================

export async function registerChannelsEnrichLlmWorker(
  boss: Pick<PgBoss, "work">,
): Promise<void> {
  await boss.work(
    JOB_NAME,
    channelsEnrichLlmWorkerOptions,
    async (job: ChannelsEnrichLlmJob | ChannelsEnrichLlmJob[]) => {
      const jobs = Array.isArray(job) ? job : [job];

      for (const current of jobs) {
        const payload = parseJobPayload(JOB_NAME, current.data);

        try {
          await executeChannelLlmEnrichment(payload);
        } catch (error) {
          process.stderr.write(
            `[worker] ${JOB_NAME} failed for ${payload.channelId}: ${formatErrorMessage(error)}\n`,
          );
          throw error;
        }
      }
    },
  );
}

// ============================================================================
// 5. DURABLE CLAIM PATTERN
// If a job has persisted execution state, do the claim in the core service
// with one guarded write, not a read-then-update sequence.
// ============================================================================
//
// const claimed = await prisma.channelEnrichment.updateMany({
//   where: {
//     channelId: input.channelId,
//     status: {
//       in: ["queued", "failed", "stale"],
//     },
//   },
//   data: {
//     status: "running",
//     startedAt: new Date(),
//     lastError: null,
//   },
// });
//
// if (claimed.count === 0) {
//   return;
// }
//
// Keep that state transition close to the business logic it protects.

// ============================================================================
// PATTERN CHECKLIST
// ============================================================================
//
// Before merging a new worker job, verify:
//
// □ Job name is registered in shared/packages/contracts/src/jobs.ts
// □ Payload parsed with parseJobPayload()
// □ Worker delegates to a core service instead of inlining business logic
// □ teamConcurrency/batchSize explicitly set
// □ Failures logged with enough context for operators
// □ Errors re-thrown so pg-boss can retry when appropriate
// □ If the job has durable state, claim/status updates happen in core
// □ Integration test covers success and failure paths
//
// ============================================================================
