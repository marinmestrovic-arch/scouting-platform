import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  resolve: {
    alias: {
      "next/server": "next/server.js"
    }
  },
  test: {
    include: ["**/*.test.ts"]
  }
});
