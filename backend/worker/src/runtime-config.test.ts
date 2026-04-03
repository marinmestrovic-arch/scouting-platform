import { describe, expect, it } from "vitest";

import { getWorkerRuntimeConfig } from "./runtime-config";

describe("getWorkerRuntimeConfig", () => {
  it("applies bounded default job concurrency values", () => {
    const config = getWorkerRuntimeConfig({
      DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
    });

    expect(config.pgBossSchema).toBe("pgboss");
    expect(config.jobs.runsDiscover.teamConcurrency).toBe(2);
    expect(config.jobs.channelsEnrichLlm.teamConcurrency).toBe(2);
    expect(config.jobs.channelsEnrichHypeauditor.teamConcurrency).toBe(1);
  });

  it("allows per-job concurrency overrides", () => {
    const config = getWorkerRuntimeConfig({
      DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
      WORKER_RUNS_DISCOVER_CONCURRENCY: "3",
      WORKER_EXPORTS_CSV_GENERATE_CONCURRENCY: "2",
    });

    expect(config.jobs.runsDiscover.teamConcurrency).toBe(3);
    expect(config.jobs.exportsCsvGenerate.teamConcurrency).toBe(2);
  });

  it("rejects invalid concurrency overrides", () => {
    expect(() =>
      getWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
        WORKER_RUNS_DISCOVER_CONCURRENCY: "0",
      }),
    ).toThrow("WORKER_RUNS_DISCOVER_CONCURRENCY must be a positive integer");
  });
});
