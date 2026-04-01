import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Core integration suites share one Postgres database and must not run in parallel by file.
    fileParallelism: false,
  },
});
