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
  testMatch: ["**/smoke.spec.ts", "**/authenticated.spec.ts"],
  fullyParallel: false,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "on-first-retry",
  },
  webServer: {
    command: "next start -p 3101 -H 127.0.0.1",
    env: {
      ...process.env,
      AUTH_TRUST_HOST: "true",
      AUTH_SECRET:
        process.env.AUTH_SECRET ??
        process.env.NEXTAUTH_SECRET ??
        "playwright-smoke-auth-secret-not-for-production",
    },
    url: "http://127.0.0.1:3101",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
