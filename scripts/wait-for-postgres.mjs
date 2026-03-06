import { spawnSync } from "node:child_process";

const maxAttempts = Number.parseInt(process.env.DB_WAIT_ATTEMPTS ?? "30", 10);
const sleepMs = Number.parseInt(process.env.DB_WAIT_INTERVAL_MS ?? "2000", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkPostgresReady() {
  return spawnSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "scouting", "-d", "scouting_platform"],
    { stdio: "ignore" },
  );
}

async function main() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = checkPostgresReady();
    if (result.status === 0) {
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

  process.stderr.write(
    "\nPostgres did not become ready. Run `pnpm infra:ps` and `pnpm infra:logs` for troubleshooting.\n",
  );
  process.exit(1);
}

main();
