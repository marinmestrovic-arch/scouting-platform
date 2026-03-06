import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const pgbossMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260305174500_pgboss_setup/migration.sql",
);
const week1MigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260305213000_week1_auth_catalog/migration.sql",
);

describe("pg-boss migration", () => {
  it("installs the pgboss schema and version table", () => {
    const migrationSql = readFileSync(pgbossMigrationPath, "utf-8");

    expect(migrationSql).toContain("CREATE SCHEMA IF NOT EXISTS pgboss");
    expect(migrationSql).toContain("CREATE TABLE pgboss.version");
    expect(migrationSql).toContain("INSERT INTO pgboss.version(version)");
  });
});

describe("week 1 auth/catalog migration", () => {
  it("creates auth, credentials, channel, and audit tables", () => {
    const migrationSql = readFileSync(week1MigrationPath, "utf-8");

    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS sessions");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS user_provider_credentials");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS channels");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS audit_events");
  });
});
