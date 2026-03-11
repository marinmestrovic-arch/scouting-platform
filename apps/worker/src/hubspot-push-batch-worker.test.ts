import { executeHubspotPushBatch } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import {
  hubspotPushBatchWorkerOptions,
  registerHubspotPushBatchWorker,
} from "./hubspot-push-batch-worker";

vi.mock("@scouting-platform/core", () => ({
  executeHubspotPushBatch: vi.fn(),
}));

describe("hubspot.push.batch worker registration", () => {
  it("registers hubspot.push.batch with explicit bounded concurrency options", async () => {
    const work = vi.fn(async () => "hubspot-push-batch-worker");

    await registerHubspotPushBatchWorker({ work } as unknown as Pick<PgBoss, "work">);

    expect(work).toHaveBeenCalledTimes(1);
    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected hubspot.push.batch worker to be registered");
    }

    const [name, options] = call as unknown as [
      string,
      typeof hubspotPushBatchWorkerOptions,
      unknown,
    ];
    expect(name).toBe("hubspot.push.batch");
    expect(options).toEqual(hubspotPushBatchWorkerOptions);
  });

  it("parses and executes each job payload", async () => {
    const work = vi.fn(async () => "hubspot-push-batch-worker");

    await registerHubspotPushBatchWorker({ work } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected hubspot.push.batch worker to be registered");
    }

    const [, , handler] = call as unknown as [
      string,
      typeof hubspotPushBatchWorkerOptions,
      (job: unknown) => Promise<void>,
    ];
    const requestA = {
      pushBatchId: "11111111-1111-4111-8111-111111111111",
      requestedByUserId: "22222222-2222-4222-8222-222222222222",
    };
    const requestB = {
      pushBatchId: "33333333-3333-4333-8333-333333333333",
      requestedByUserId: "44444444-4444-4444-8444-444444444444",
    };

    await handler([{ data: requestA }, { data: requestB }]);

    expect(vi.mocked(executeHubspotPushBatch)).toHaveBeenNthCalledWith(1, requestA);
    expect(vi.mocked(executeHubspotPushBatch)).toHaveBeenNthCalledWith(2, requestB);
  });
});
