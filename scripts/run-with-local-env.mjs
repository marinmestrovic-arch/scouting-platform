import { spawnSync } from "node:child_process";
import process from "node:process";

import { loadLocalEnv } from "./local-env.mjs";

const args = process.argv.slice(2);

if (args.length === 0) {
  process.stderr.write("Usage: node scripts/run-with-local-env.mjs <command> [args...]\n");
  process.exit(1);
}

loadLocalEnv();

const result = spawnSync(args[0], args.slice(1), {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  const message = result.error instanceof Error ? result.error.message : String(result.error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
