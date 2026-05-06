import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: fileURLToPath(
      new URL("../../../scripts/test-db-guard.mjs", import.meta.url),
    ),
  },
});
