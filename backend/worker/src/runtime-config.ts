import process from "node:process";

export type WorkerJobOptions = Readonly<{
  teamSize: number;
  teamConcurrency: number;
  batchSize: number;
}>;

export type WorkerRuntimeConfig = Readonly<{
  databaseUrl: string;
  pgBossSchema: string;
  jobs: Readonly<{
    runsDiscover: WorkerJobOptions;
    runsAssessChannelFit: WorkerJobOptions;
    channelsEnrichLlm: WorkerJobOptions;
    channelsEnrichHypeauditor: WorkerJobOptions;
    importsCsvProcess: WorkerJobOptions;
    exportsCsvGenerate: WorkerJobOptions;
    hubspotPreviewEnrich: WorkerJobOptions;
    hubspotImportBatch: WorkerJobOptions;
    hubspotPushBatch: WorkerJobOptions;
  }>;
}>;

function getRequiredEnv(env: NodeJS.ProcessEnv, name: "DATABASE_URL"): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getRequiredExactByteLengthEnv(
  env: NodeJS.ProcessEnv,
  name: "APP_ENCRYPTION_KEY",
  byteLength: number,
): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  if (Buffer.byteLength(value, "utf8") !== byteLength) {
    throw new Error(`${name} must be exactly ${byteLength} bytes`);
  }

  return value;
}

function parsePositiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
): number {
  const rawValue = env[name]?.trim();

  if (!rawValue) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsedValue;
}

function buildWorkerJobOptions(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultConcurrency: number,
): WorkerJobOptions {
  return {
    teamSize: 1,
    teamConcurrency: parsePositiveInt(env, name, defaultConcurrency),
    batchSize: 1,
  };
}

export function getWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerRuntimeConfig {
  getRequiredExactByteLengthEnv(env, "APP_ENCRYPTION_KEY", 32);

  return {
    databaseUrl: getRequiredEnv(env, "DATABASE_URL"),
    pgBossSchema: env.PG_BOSS_SCHEMA?.trim() || "pgboss",
    jobs: {
      runsDiscover: buildWorkerJobOptions(env, "WORKER_RUNS_DISCOVER_CONCURRENCY", 1),
      runsAssessChannelFit: buildWorkerJobOptions(
        env,
        "WORKER_RUNS_ASSESS_CHANNEL_FIT_CONCURRENCY",
        2,
      ),
      channelsEnrichLlm: buildWorkerJobOptions(env, "WORKER_CHANNELS_ENRICH_LLM_CONCURRENCY", 2),
      channelsEnrichHypeauditor: buildWorkerJobOptions(
        env,
        "WORKER_CHANNELS_ENRICH_HYPEAUDITOR_CONCURRENCY",
        1,
      ),
      importsCsvProcess: buildWorkerJobOptions(env, "WORKER_IMPORTS_CSV_PROCESS_CONCURRENCY", 1),
      exportsCsvGenerate: buildWorkerJobOptions(
        env,
        "WORKER_EXPORTS_CSV_GENERATE_CONCURRENCY",
        1,
      ),
      hubspotPreviewEnrich: buildWorkerJobOptions(
        env,
        "WORKER_HUBSPOT_PREVIEW_ENRICH_CONCURRENCY",
        1,
      ),
      hubspotImportBatch: buildWorkerJobOptions(
        env,
        "WORKER_HUBSPOT_IMPORT_BATCH_CONCURRENCY",
        1,
      ),
      hubspotPushBatch: buildWorkerJobOptions(env, "WORKER_HUBSPOT_PUSH_BATCH_CONCURRENCY", 1),
    },
  };
}
