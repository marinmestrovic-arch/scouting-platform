import process from "node:process";
import { PgBoss } from "pg-boss";

import { registerChannelsEnrichHypeAuditorWorker } from "./channels-enrich-hypeauditor-worker";
import { registerChannelsEnrichLlmWorker } from "./channels-enrich-llm-worker";
import { registerExportsCsvGenerateWorker } from "./exports-csv-generate-worker";
import { registerHubspotImportBatchWorker } from "./hubspot-import-batch-worker";
import { registerHubspotPushBatchWorker } from "./hubspot-push-batch-worker";
import { registerImportsCsvProcessWorker } from "./imports-csv-process-worker";
import { JOB_NAMES } from "./jobs";
import { registerRunsDiscoverWorker } from "./runs-discover-worker";

type WorkerRuntimeConfig = {
  databaseUrl: string;
  pgBossSchema: string;
};

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

function getRequiredEnv(name: "DATABASE_URL"): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getWorkerRuntimeConfig(): WorkerRuntimeConfig {
  return {
    databaseUrl: getRequiredEnv("DATABASE_URL"),
    pgBossSchema: process.env.PG_BOSS_SCHEMA?.trim() || "pgboss",
  };
}

async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of JOB_NAMES) {
    await boss.createQueue(name);
  }
}

async function registerWorkers(boss: PgBoss): Promise<void> {
  await registerRunsDiscoverWorker(boss);
  await registerChannelsEnrichLlmWorker(boss);
  await registerChannelsEnrichHypeAuditorWorker(boss);
  await registerImportsCsvProcessWorker(boss);
  await registerExportsCsvGenerateWorker(boss);
  await registerHubspotImportBatchWorker(boss);
  await registerHubspotPushBatchWorker(boss);
}

async function startWorker(): Promise<void> {
  const config = getWorkerRuntimeConfig();

  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: config.pgBossSchema,
    migrate: false,
  });

  boss.on("error", (error) => {
    process.stderr.write(`[worker] pg-boss error: ${formatErrorMessage(error)}\n`);
  });

  await boss.start();
  await ensureQueues(boss);
  await registerWorkers(boss);
  process.stdout.write(`[worker] started with schema "${config.pgBossSchema}"\n`);

  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    process.stdout.write(`[worker] received ${signal}, shutting down\n`);

    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
      process.stdout.write("[worker] stopped cleanly\n");
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(`[worker] failed to stop cleanly: ${formatErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void startWorker().catch((error) => {
  process.stderr.write(`[worker] startup failed: ${formatErrorMessage(error)}\n`);
  process.exit(1);
});
