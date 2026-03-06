import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const image = process.env.POSTGRES_IMAGE ?? "postgres:17-alpine";
const severity = process.env.TRIVY_SEVERITY ?? "HIGH,CRITICAL";
const cacheDir = process.env.TRIVY_CACHE_DIR ?? join(tmpdir(), "trivy-cache");

mkdirSync(cacheDir, { recursive: true });

function runOrExit(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write(`Pulling ${image} before advisory scan...\n`);
runOrExit("docker", ["pull", image]);

process.stdout.write(
  `Running advisory Trivy scan for ${image} (severity: ${severity})...\n`,
);
runOrExit("docker", [
  "run",
  "--rm",
  "-v",
  "/var/run/docker.sock:/var/run/docker.sock",
  "-v",
  `${cacheDir}:/root/.cache/`,
  "aquasec/trivy:latest",
  "image",
  "--scanners",
  "vuln",
  "--severity",
  severity,
  "--exit-code",
  "0",
  image,
]);

process.stdout.write("Advisory scan completed.\n");
