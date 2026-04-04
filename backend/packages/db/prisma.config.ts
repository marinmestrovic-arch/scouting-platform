import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, env } from "prisma/config";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(packageDir, "../../..");
const workspaceEnvPath = path.join(workspaceRoot, ".env");

if (fs.existsSync(workspaceEnvPath)) {
  const envContent = fs.readFileSync(workspaceEnvPath, "utf8");

  for (const rawLine of envContent.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalizedLine.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();

    if (!key) {
      continue;
    }

    let value = normalizedLine.slice(separatorIndex + 1).trim();

    if (value.length >= 2) {
      const quote = value[0];
      const lastCharacter = value.at(-1);

      if ((quote === '"' || quote === "'") && lastCharacter === quote) {
        value = value.slice(1, -1);
      }
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
