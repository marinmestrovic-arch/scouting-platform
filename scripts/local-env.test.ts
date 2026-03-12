import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { applyLocalEnv, loadLocalEnv, parseLocalEnvContent } from "./local-env.mjs";

describe("local env loader", () => {
  it("parses quoted values literally without expanding dollar-prefixed text", () => {
    const values = parseLocalEnvContent(
      'AUTH_SECRET="prefix$Uk0HqLwDq7RXpdrGsYwZcuXAc25ljVhyWpiOwyl8MpOKUn3u22M9y"\nAPP_ENCRYPTION_KEY="12345678901234567890123456789012"\n',
    );

    expect(values.AUTH_SECRET).toBe(
      "prefix$Uk0HqLwDq7RXpdrGsYwZcuXAc25ljVhyWpiOwyl8MpOKUn3u22M9y",
    );
    expect(values.APP_ENCRYPTION_KEY).toBe("12345678901234567890123456789012");
  });

  it("keeps existing environment values by default", () => {
    const targetEnv = {
      DATABASE_URL: "postgresql://existing",
      DATABASE_URL_TEST: "postgresql://existing-test",
    };

    applyLocalEnv(
      targetEnv,
      {
        DATABASE_URL: "postgresql://from-file",
        DATABASE_URL_TEST: "postgresql://from-file-test",
        AUTH_SECRET: "from-file-auth-secret",
      },
      { override: false },
    );

    expect(targetEnv.DATABASE_URL).toBe("postgresql://existing");
    expect(targetEnv.DATABASE_URL_TEST).toBe("postgresql://existing-test");
    expect(targetEnv.AUTH_SECRET).toBe("from-file-auth-secret");
  });

  it("loads .env values for child commands without shell expansion", () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), "scouting-local-env-"));

    try {
      writeFileSync(
        path.join(tempDirectory, ".env"),
        'AUTH_SECRET="prefix$Uk0HqLwDq7RXpdrGsYwZcuXAc25ljVhyWpiOwyl8MpOKUn3u22M9y"\nNEXT_PUBLIC_APP_URL="http://localhost:3000"\n',
        "utf8",
      );

      const result = spawnSync(
        process.execPath,
        [
          path.join(process.cwd(), "scripts/run-with-local-env.mjs"),
          process.execPath,
          "-e",
          "process.stdout.write(process.env.AUTH_SECRET ?? '')",
        ],
        {
          cwd: tempDirectory,
          env: { ...process.env },
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("prefix$Uk0HqLwDq7RXpdrGsYwZcuXAc25ljVhyWpiOwyl8MpOKUn3u22M9y");
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true });
    }
  });

  it("loads .env files into a provided target env object", () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), "scouting-local-env-load-"));

    try {
      writeFileSync(
        path.join(tempDirectory, ".env"),
        'INITIAL_ADMIN_EMAIL="admin@example.com"\n',
        "utf8",
      );

      const targetEnv = {};

      loadLocalEnv({ cwd: tempDirectory, targetEnv });

      expect(targetEnv.INITIAL_ADMIN_EMAIL).toBe("admin@example.com");
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true });
    }
  });
});
