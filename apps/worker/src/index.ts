import process from "node:process";
import { PgBoss } from "pg-boss";
import { parseJobPayload } from "@scouting-platform/contracts";
import { executeRunDiscover } from "@scouting-platform/core";

import { JOB_NAMES } from "./jobs";

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
  await boss.work("runs.discover", async (job) => {
    const jobs = Array.isArray(job) ? job : [job];

    for (const current of jobs) {
      const payload = parseJobPayload("runs.discover", current.data);

      try {
        await executeRunDiscover(payload);
      } catch (error) {
        process.stderr.write(
          `[worker] runs.discover failed for ${payload.runRequestId}: ${formatErrorMessage(error)}\n`,
        );
        throw error;
      }
    }
  });
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
