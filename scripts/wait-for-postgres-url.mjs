import process from "node:process";
import { spawnSync } from "node:child_process";

const maxAttempts = Number.parseInt(process.env.DB_WAIT_ATTEMPTS ?? "30", 10);
const sleepMs = Number.parseInt(process.env.DB_WAIT_INTERVAL_MS ?? "2000", 10);
if (!process.env.DATABASE_URL?.trim()) {
  process.stderr.write("DATABASE_URL is required.\n");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReady() {
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@scouting-platform/db",
      "exec",
      "prisma",
      "db",
      "execute",
      "--stdin",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      input: "SELECT 1;",
      stdio: "ignore",
    },
  );

  return result.status === 0;
}

async function main() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (isReady()) {
      process.stdout.write("Postgres is ready.\n");
      return;
    }

    process.stdout.write(
      `Waiting for Postgres (${attempt}/${maxAttempts})...` + (attempt < maxAttempts ? "\n" : ""),
    );

    if (attempt < maxAttempts) {
      await sleep(sleepMs);
    }
  }

  process.stderr.write("\nPostgres did not become ready.\n");
  process.exit(1);
}

void main();
