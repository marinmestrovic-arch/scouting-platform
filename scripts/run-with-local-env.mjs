import { spawnSync } from "node:child_process";
import process from "node:process";

import { loadLocalEnv } from "./local-env.mjs";

const rawArgs = process.argv.slice(2);
const overrideIndex = rawArgs.indexOf("--override-env");
const override = overrideIndex !== -1;
const overrideKeysArg = rawArgs.find((arg) => arg.startsWith("--override-keys="));
const overrideKeys = new Set(
  (overrideKeysArg?.slice("--override-keys=".length).split(",") ?? [])
    .map((value) => value.trim())
    .filter(Boolean),
);
const args = rawArgs.filter(
  (arg) => arg !== "--override-env" && !arg.startsWith("--override-keys="),
);

if (args.length === 0) {
  process.stderr.write(
    "Usage: node scripts/run-with-local-env.mjs [--override-env] [--override-keys=KEY1,KEY2] <command> [args...]\n",
  );
  process.exit(1);
}

if (overrideKeys.size > 0) {
  const loadedValues = loadLocalEnv({ targetEnv: {} });

  for (const key of overrideKeys) {
    if (loadedValues[key] !== undefined) {
      process.env[key] = loadedValues[key];
    }
  }
} else {
  loadLocalEnv({ override });
}

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
