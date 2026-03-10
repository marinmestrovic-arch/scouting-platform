import { executeAdvancedReportRequest } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import {
  channelsEnrichHypeAuditorWorkerOptions,
  registerChannelsEnrichHypeAuditorWorker,
} from "./channels-enrich-hypeauditor-worker";

vi.mock("@scouting-platform/core", () => ({
  executeAdvancedReportRequest: vi.fn(),
}));

describe("channels.enrich.hypeauditor worker registration", () => {
  it("registers channels.enrich.hypeauditor with explicit bounded concurrency options", async () => {
    const work = vi.fn(async () => "channels-enrich-hypeauditor-worker");

    await registerChannelsEnrichHypeAuditorWorker({ work } as unknown as Pick<PgBoss, "work">);

    expect(work).toHaveBeenCalledTimes(1);
    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected channels.enrich.hypeauditor worker to be registered");
    }

    const [name, options] = call as unknown as [
      string,
      typeof channelsEnrichHypeAuditorWorkerOptions,
      unknown,
    ];
    expect(name).toBe("channels.enrich.hypeauditor");
    expect(options).toEqual(channelsEnrichHypeAuditorWorkerOptions);
  });

  it("parses and executes each job payload", async () => {
    const work = vi.fn(async () => "channels-enrich-hypeauditor-worker");

    await registerChannelsEnrichHypeAuditorWorker({ work } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected channels.enrich.hypeauditor worker to be registered");
    }

    const [, , handler] = call as unknown as [
      string,
      typeof channelsEnrichHypeAuditorWorkerOptions,
      (job: unknown) => Promise<void>,
    ];
    const requestA = {
      advancedReportRequestId: "11111111-1111-4111-8111-111111111111",
      requestedByUserId: "22222222-2222-4222-8222-222222222222",
    };
    const requestB = {
      advancedReportRequestId: "33333333-3333-4333-8333-333333333333",
      requestedByUserId: "44444444-4444-4444-8444-444444444444",
    };

    await handler([
      { data: requestA },
      { data: requestB },
    ]);

    expect(vi.mocked(executeAdvancedReportRequest)).toHaveBeenNthCalledWith(1, requestA);
    expect(vi.mocked(executeAdvancedReportRequest)).toHaveBeenNthCalledWith(2, requestB);
  });
});
