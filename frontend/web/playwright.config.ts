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
      AUTH_URL: "http://127.0.0.1:3101",
      NEXTAUTH_URL: "http://127.0.0.1:3101",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3101",
    },
    url: "http://127.0.0.1:3101",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
