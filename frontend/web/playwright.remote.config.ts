import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { defineConfig } from "@playwright/test";

import { ensurePlaywrightEnvironment } from "./e2e/test-env";

function loadRootEnv(): void {
  const workspaceRoot = path.resolve(process.cwd(), "../..");

  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(workspaceRoot, fileName);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      const equalsIndex = trimmedLine.indexOf("=");

      if (equalsIndex <= 0) {
        continue;
      }

      const key = trimmedLine.slice(0, equalsIndex).trim();
      const rawValue = trimmedLine.slice(equalsIndex + 1).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = rawValue.replace(/^['"]|['"]$/gu, "");
    }
  }
}

loadRootEnv();
ensurePlaywrightEnvironment();

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/smoke.spec.ts", "**/remote-authenticated.spec.ts"],
  fullyParallel: false,
  timeout: 45_000,
  retries: 1,
  reporter: "list",
  use: {
    baseURL: "https://scouting.marsilux.com",
    trace: "on-first-retry",
  },
  // No webServer block — the server is already running remotely.
});
