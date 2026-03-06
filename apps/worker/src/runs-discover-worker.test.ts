import { executeRunDiscover } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import {
  registerRunsDiscoverWorker,
  runsDiscoverWorkerOptions,
} from "./runs-discover-worker";

vi.mock("@scouting-platform/core", () => ({
  executeRunDiscover: vi.fn(),
}));

describe("runs.discover worker registration", () => {
  it("registers runs.discover with explicit bounded concurrency options", async () => {
    const work = vi.fn(async () => "runs-discover-worker");

    await registerRunsDiscoverWorker({ work } as unknown as Pick<PgBoss, "work">);

    expect(work).toHaveBeenCalledTimes(1);
    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected runs.discover worker to be registered");
    }

    const [name, options] = call as unknown as [
      string,
      typeof runsDiscoverWorkerOptions,
      unknown,
    ];
    expect(name).toBe("runs.discover");
    expect(options).toEqual(runsDiscoverWorkerOptions);
  });

  it("parses and executes each job payload", async () => {
    const work = vi.fn(async () => "runs-discover-worker");

    await registerRunsDiscoverWorker({ work } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected runs.discover worker to be registered");
    }

    const [, , handler] = call as unknown as [
      string,
      typeof runsDiscoverWorkerOptions,
      (job: unknown) => Promise<void>,
    ];
    const runA = {
      runRequestId: "11111111-1111-4111-8111-111111111111",
      requestedByUserId: "22222222-2222-4222-8222-222222222222",
    };
    const runB = {
      runRequestId: "33333333-3333-4333-8333-333333333333",
      requestedByUserId: "44444444-4444-4444-8444-444444444444",
    };

    await handler([
      { data: runA },
      { data: runB },
    ]);

    expect(vi.mocked(executeRunDiscover)).toHaveBeenNthCalledWith(1, runA);
    expect(vi.mocked(executeRunDiscover)).toHaveBeenNthCalledWith(2, runB);
  });
});
