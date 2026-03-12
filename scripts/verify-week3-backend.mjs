import { spawnSync } from "node:child_process";
import process from "node:process";

import { loadLocalEnv } from "./local-env.mjs";

loadLocalEnv();

const databaseUrlTest = process.env.DATABASE_URL_TEST?.trim();

if (!databaseUrlTest) {
  process.stderr.write("DATABASE_URL_TEST is required\n");
  process.exit(1);
}

for (const args of [
  ["-w", "vitest", "packages/core/src/week3.integration.test.ts", "--run"],
  ["-w", "vitest", "apps/web/app/api/week3.integration.test.ts", "--run"],
]) {
  const result = spawnSync("pnpm", args, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    const message = result.error instanceof Error ? result.error.message : String(result.error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
