import { PgBoss } from "pg-boss";

import {
  parseJobPayload,
  type JobName,
  type JobPayloadByName,
} from "@scouting-platform/contracts";

import { ServiceError } from "./errors";

let bossPromise: Promise<PgBoss> | null = null;
const ensuredQueues = new Set<JobName>();
export type EnqueueJobOptions = Readonly<{
  priority?: number;
  startAfter?: number | string | Date;
  singletonKey?: string;
  singletonSeconds?: number;
}>;

type EnqueueBulkJobOptions = Readonly<{ priority?: number }>;

function parseEnqueueOptions(options: EnqueueJobOptions): EnqueueJobOptions {
  if (
    options.priority !== undefined
    && (
      !Number.isInteger(options.priority)
      || options.priority < -2_147_483_648
      || options.priority > 2_147_483_647
    )
  ) {
    throw new ServiceError("INVALID_JOB_PRIORITY", 400, "Job priority must be a 32-bit integer");
  }

  if (
    options.startAfter !== undefined
    && typeof options.startAfter === "number"
    && (!Number.isFinite(options.startAfter) || options.startAfter < 0)
  ) {
    throw new ServiceError(
      "INVALID_JOB_START_AFTER",
      400,
      "Job startAfter must be a non-negative number, date, or date string",
    );
  }

  if (
    typeof options.startAfter === "string"
    && (
      options.startAfter.trim().length === 0
      || Number.isNaN(Date.parse(options.startAfter))
    )
  ) {
    throw new ServiceError(
      "INVALID_JOB_START_AFTER",
      400,
      "Job startAfter must be a non-negative number, date, or date string",
    );
  }

  if (
    options.startAfter instanceof Date
    && Number.isNaN(options.startAfter.getTime())
  ) {
    throw new ServiceError(
      "INVALID_JOB_START_AFTER",
      400,
      "Job startAfter must be a non-negative number, date, or date string",
    );
  }

  const singletonKey = options.singletonKey?.trim();
  if (options.singletonKey !== undefined && !singletonKey) {
    throw new ServiceError(
      "INVALID_JOB_SINGLETON_KEY",
      400,
      "Job singletonKey must not be empty",
    );
  }

  if (
    options.singletonSeconds !== undefined
    && (
      !Number.isInteger(options.singletonSeconds)
      || options.singletonSeconds < 1
    )
  ) {
    throw new ServiceError(
      "INVALID_JOB_SINGLETON_SECONDS",
      400,
      "Job singletonSeconds must be a positive integer",
    );
  }

  if (options.singletonSeconds !== undefined && !singletonKey) {
    throw new ServiceError(
      "MISSING_JOB_SINGLETON_KEY",
      400,
      "singletonSeconds requires singletonKey",
    );
  }

  return {
    ...(options.priority === undefined ? {} : { priority: options.priority }),
    ...(options.startAfter === undefined ? {} : { startAfter: options.startAfter }),
    ...(singletonKey === undefined ? {} : { singletonKey }),
    ...(options.singletonSeconds === undefined
      ? {}
      : { singletonSeconds: options.singletonSeconds }),
  };
}

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
      return boss;
    })();
  }

  return bossPromise;
}

async function ensureQueue(name: JobName): Promise<void> {
  if (ensuredQueues.has(name)) {
    return;
  }

  const boss = await getBoss();
  await boss.createQueue(name);
  ensuredQueues.add(name);
}

export async function enqueueJob<Name extends JobName>(
  name: Name,
  payload: JobPayloadByName[Name],
  options: EnqueueJobOptions = {},
): Promise<void> {
  const parsedPayload = parseJobPayload(name, payload);
  const parsedOptions = parseEnqueueOptions(options);
  const boss = await getBoss();
  await ensureQueue(name);
  await boss.send(name, parsedPayload, {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    ...parsedOptions,
  });
}

export async function enqueueChannelLlmJobs(
  payloads: readonly JobPayloadByName["channels.enrich.llm"][],
  options: EnqueueBulkJobOptions = {},
): Promise<void> {
  if (payloads.length === 0) {
    return;
  }

  const parsedOptions = parseEnqueueOptions(options);
  const parsedPayloads = payloads.map((payload) =>
    parseJobPayload("channels.enrich.llm", payload),
  );
  const boss = await getBoss();
  await ensureQueue("channels.enrich.llm");
  await boss.insert(
    "channels.enrich.llm",
    parsedPayloads.map((data) => ({
      data,
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      ...parsedOptions,
    })),
  );
}

export async function stopQueueRuntime(): Promise<void> {
  if (!bossPromise) {
    return;
  }

  const boss = await bossPromise;
  bossPromise = null;
  ensuredQueues.clear();
  await boss.stop();
}
