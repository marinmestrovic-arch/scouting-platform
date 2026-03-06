import process from "node:process";

import { PgBoss } from "pg-boss";

import { parseJobPayload } from "@scouting-platform/contracts";

import { ServiceError } from "../errors";

let bossPromise: Promise<PgBoss> | null = null;

function getQueueRuntimeConfig(): { databaseUrl: string; schema: string } {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new ServiceError("MISSING_DATABASE_URL", 500, "DATABASE_URL is required for queue access");
  }

  return {
    databaseUrl,
    schema: process.env.PG_BOSS_SCHEMA?.trim() || "pgboss",
  };
}

async function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    const config = getQueueRuntimeConfig();
    const boss = new PgBoss({
      connectionString: config.databaseUrl,
      schema: config.schema,
      migrate: false,
    });

    bossPromise = (async () => {
      await boss.start();
      await boss.createQueue("runs.discover");
      return boss;
    })();
  }

  return bossPromise;
}

export async function enqueueRunsDiscoverJob(payload: {
  runRequestId: string;
  requestedByUserId: string;
}): Promise<void> {
  const parsedPayload = parseJobPayload("runs.discover", payload);
  const boss = await getBoss();
  await boss.send("runs.discover", parsedPayload, {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
  });
}

export async function stopRunsQueue(): Promise<void> {
  if (!bossPromise) {
    return;
  }

  const boss = await bossPromise;
  bossPromise = null;
  await boss.stop();
}
