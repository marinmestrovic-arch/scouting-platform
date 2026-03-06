import process from "node:process";

import { z } from "zod";

const workerEnvironmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must be a Postgres connection string",
    ),
  PG_BOSS_SCHEMA: z.string().min(1).default("pgboss"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseWorkerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): WorkerEnvironment {
  return workerEnvironmentSchema.parse({
    DATABASE_URL: normalize(env.DATABASE_URL),
    PG_BOSS_SCHEMA: normalize(env.PG_BOSS_SCHEMA),
    LOG_LEVEL: normalize(env.LOG_LEVEL),
  });
}
