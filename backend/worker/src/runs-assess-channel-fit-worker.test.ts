import { executeRunChannelFitAssessment } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerRunsAssessChannelFitWorker,
  runsAssessChannelFitWorkerOptions,
} from "./runs-assess-channel-fit-worker";

vi.mock("@scouting-platform/core", () => ({
  executeRunChannelFitAssessment: vi.fn(),
}));

describe("runs.assess.channel-fit worker registration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers runs.assess.channel-fit with explicit bounded concurrency options", async () => {
    const work = vi.fn(async () => "runs-assess-channel-fit-worker");

    await registerRunsAssessChannelFitWorker({ work } as unknown as Pick<PgBoss, "work">);

    expect(work).toHaveBeenCalledTimes(1);
    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected runs.assess.channel-fit worker to be registered");
    }

    const [name, options] = call as unknown as [
      string,
      typeof runsAssessChannelFitWorkerOptions,
      unknown,
    ];
    expect(name).toBe("runs.assess.channel-fit");
    expect(options).toEqual(runsAssessChannelFitWorkerOptions);
  });

  it("parses and executes a single job payload", async () => {
    const work = vi.fn(async () => "runs-assess-channel-fit-worker");

    await registerRunsAssessChannelFitWorker({ work } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected runs.assess.channel-fit worker to be registered");
    }

    const [, , handler] = call as unknown as [
      string,
      typeof runsAssessChannelFitWorkerOptions,
      (job: unknown) => Promise<void>,
    ];
    const request = {
      runRequestId: "11111111-1111-4111-8111-111111111111",
      channelId: "22222222-2222-4222-8222-222222222222",
      requestedByUserId: "33333333-3333-4333-8333-333333333333",
    };

    await handler({ data: request });

    expect(vi.mocked(executeRunChannelFitAssessment)).toHaveBeenCalledWith(request);
  });

  it("parses and executes a batch of jobs", async () => {
    const work = vi.fn(async () => "runs-assess-channel-fit-worker");

    await registerRunsAssessChannelFitWorker({ work } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected runs.assess.channel-fit worker to be registered");
    }

    const [, , handler] = call as unknown as [
      string,
      typeof runsAssessChannelFitWorkerOptions,
      (job: unknown) => Promise<void>,
    ];
    const requestA = {
      runRequestId: "11111111-1111-4111-8111-111111111111",
      channelId: "22222222-2222-4222-8222-222222222222",
      requestedByUserId: "33333333-3333-4333-8333-333333333333",
    };
    const requestB = {
      runRequestId: "44444444-4444-4444-8444-444444444444",
      channelId: "55555555-5555-4555-8555-555555555555",
      requestedByUserId: "66666666-6666-4666-8666-666666666666",
    };

    await handler([{ data: requestA }, { data: requestB }]);

    expect(vi.mocked(executeRunChannelFitAssessment)).toHaveBeenNthCalledWith(1, requestA);
    expect(vi.mocked(executeRunChannelFitAssessment)).toHaveBeenNthCalledWith(2, requestB);
  });

  it("logs and re-throws errors so pg-boss can retry", async () => {
    const work = vi.fn(async () => "runs-assess-channel-fit-worker");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const error = new Error("boom");
    vi.mocked(executeRunChannelFitAssessment).mockRejectedValueOnce(error);

    await registerRunsAssessChannelFitWorker({ work } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected runs.assess.channel-fit worker to be registered");
    }

    const [, , handler] = call as unknown as [
      string,
      typeof runsAssessChannelFitWorkerOptions,
      (job: unknown) => Promise<void>,
    ];
    const request = {
      runRequestId: "11111111-1111-4111-8111-111111111111",
      channelId: "22222222-2222-4222-8222-222222222222",
      requestedByUserId: "33333333-3333-4333-8333-333333333333",
    };

    await expect(handler({ data: request })).rejects.toThrow("boom");
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[worker] runs.assess.channel-fit failed for run 11111111-1111-4111-8111-111111111111 channel 22222222-2222-4222-8222-222222222222: Error: boom",
      ),
    );
  });
});
