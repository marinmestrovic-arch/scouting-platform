import { describe, expect, it } from "vitest";

import { getWorkerRuntimeConfig } from "./runtime-config";

describe("getWorkerRuntimeConfig", () => {
  it("applies bounded default job concurrency values", () => {
    const config = getWorkerRuntimeConfig({
      DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
      APP_ENCRYPTION_KEY: "12345678901234567890123456789012",
    });

    expect(config.pgBossSchema).toBe("pgboss");
    expect(config.jobs.runsDiscover.teamConcurrency).toBe(1);
    expect(config.jobs.channelsEnrichLlm.teamConcurrency).toBe(2);
    expect(config.jobs.channelsEnrichHypeauditor.teamConcurrency).toBe(1);
  });

  it("allows per-job concurrency overrides", () => {
    const config = getWorkerRuntimeConfig({
      DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
      APP_ENCRYPTION_KEY: "12345678901234567890123456789012",
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
        APP_ENCRYPTION_KEY: "12345678901234567890123456789012",
        WORKER_RUNS_DISCOVER_CONCURRENCY: "0",
      }),
    ).toThrow("WORKER_RUNS_DISCOVER_CONCURRENCY must be a positive integer");
  });

  it("requires a valid encryption key at startup", () => {
    expect(() =>
      getWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
      }),
    ).toThrow("Missing required environment variable: APP_ENCRYPTION_KEY");

    expect(() =>
      getWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
        APP_ENCRYPTION_KEY: "too-short",
      }),
    ).toThrow("APP_ENCRYPTION_KEY must be exactly 32 bytes");
  });
});
