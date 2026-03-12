import { spawnSync } from "node:child_process";
import process from "node:process";

import { loadLocalEnv } from "./local-env.mjs";

loadLocalEnv();

const databaseUrlTest = process.env.DATABASE_URL_TEST?.trim();

if (!databaseUrlTest) {
  process.stderr.write("DATABASE_URL_TEST is required\n");
  process.exit(1);
}

const result = spawnSync(
  "pnpm",
  ["--filter", "@scouting-platform/db", "db:migrate:deploy"],
  {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrlTest,
    },
    stdio: "inherit",
  },
);

if (result.error) {
  const message = result.error instanceof Error ? result.error.message : String(result.error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
