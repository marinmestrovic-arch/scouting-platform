import process from "node:process";

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
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
