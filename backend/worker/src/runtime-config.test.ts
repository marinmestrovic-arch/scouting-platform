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
    expect(config.jobs.runsAssessChannelFit.teamConcurrency).toBe(2);
    expect(config.jobs.channelsEnrichLlm.teamConcurrency).toBe(2);
    expect(config.jobs.channelsEnrichHypeauditor.teamConcurrency).toBe(1);
    expect(config.jobs.hubspotPreviewEnrich.teamConcurrency).toBe(1);
    expect(config.jobs.hubspotObjectSync.teamConcurrency).toBe(1);
    expect(config.continuousEnrichment).toEqual({
      enabled: true,
      intervalMs: 60000,
      initialDelayMs: 5000,
      batchSize: 5,
      staleAfterDays: 30,
      maxRetryCount: 5,
      processingTimeoutMs: 1800000,
      queuedTimeoutMs: 600000,
    });
  });

  it("allows per-job concurrency overrides", () => {
    const config = getWorkerRuntimeConfig({
      DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
      APP_ENCRYPTION_KEY: "12345678901234567890123456789012",
      WORKER_RUNS_DISCOVER_CONCURRENCY: "3",
      WORKER_RUNS_ASSESS_CHANNEL_FIT_CONCURRENCY: "5",
      WORKER_EXPORTS_CSV_GENERATE_CONCURRENCY: "2",
      WORKER_HUBSPOT_PREVIEW_ENRICH_CONCURRENCY: "4",
      WORKER_HUBSPOT_OBJECT_SYNC_CONCURRENCY: "3",
      WORKER_CONTINUOUS_ENRICHMENT_ENABLED: "false",
      WORKER_CONTINUOUS_ENRICHMENT_INTERVAL_MS: "120000",
      WORKER_CONTINUOUS_ENRICHMENT_INITIAL_DELAY_MS: "0",
      WORKER_CONTINUOUS_ENRICHMENT_BATCH_SIZE: "9",
      WORKER_CONTINUOUS_ENRICHMENT_STALE_AFTER_DAYS: "45",
      WORKER_CONTINUOUS_ENRICHMENT_MAX_RETRY_COUNT: "7",
      WORKER_CONTINUOUS_ENRICHMENT_PROCESSING_TIMEOUT_MS: "900000",
      WORKER_CONTINUOUS_ENRICHMENT_QUEUED_TIMEOUT_MS: "120000",
    });

    expect(config.jobs.runsDiscover.teamConcurrency).toBe(3);
    expect(config.jobs.runsAssessChannelFit.teamConcurrency).toBe(5);
    expect(config.jobs.exportsCsvGenerate.teamConcurrency).toBe(2);
    expect(config.jobs.hubspotPreviewEnrich.teamConcurrency).toBe(4);
    expect(config.jobs.hubspotObjectSync.teamConcurrency).toBe(3);
    expect(config.continuousEnrichment).toEqual({
      enabled: false,
      intervalMs: 120000,
      initialDelayMs: 0,
      batchSize: 9,
      staleAfterDays: 45,
      maxRetryCount: 7,
      processingTimeoutMs: 900000,
      queuedTimeoutMs: 120000,
    });
  });

  it("rejects invalid concurrency overrides", () => {
    expect(() =>
      getWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
        APP_ENCRYPTION_KEY: "12345678901234567890123456789012",
        WORKER_RUNS_DISCOVER_CONCURRENCY: "0",
      }),
    ).toThrow("WORKER_RUNS_DISCOVER_CONCURRENCY must be a positive integer");

    expect(() =>
      getWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
        APP_ENCRYPTION_KEY: "12345678901234567890123456789012",
        WORKER_CONTINUOUS_ENRICHMENT_INITIAL_DELAY_MS: "-1",
      }),
    ).toThrow("WORKER_CONTINUOUS_ENRICHMENT_INITIAL_DELAY_MS must be a non-negative integer");

    expect(() =>
      getWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
        APP_ENCRYPTION_KEY: "12345678901234567890123456789012",
        WORKER_CONTINUOUS_ENRICHMENT_ENABLED: "maybe",
      }),
    ).toThrow("WORKER_CONTINUOUS_ENRICHMENT_ENABLED must be a boolean");

    expect(() =>
      getWorkerRuntimeConfig({
        DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
        APP_ENCRYPTION_KEY: "12345678901234567890123456789012",
        WORKER_CONTINUOUS_ENRICHMENT_MAX_RETRY_COUNT: "0",
      }),
    ).toThrow("WORKER_CONTINUOUS_ENRICHMENT_MAX_RETRY_COUNT must be a positive integer");
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
