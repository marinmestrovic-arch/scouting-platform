import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertSafeTestDatabaseConfiguration,
  assertSelectedTestDatabaseConfiguration,
  selectSafeTestDatabaseConfiguration,
} from "../e2e/test-db-guard";

const ORIGINAL_ENV = {
  ALLOW_UNSAFE_TEST_DB: process.env.ALLOW_UNSAFE_TEST_DB,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  PLAYWRIGHT_TEST_DATABASE_SELECTED: process.env.PLAYWRIGHT_TEST_DATABASE_SELECTED,
};

function restoreEnvValue(key: keyof typeof ORIGINAL_ENV): void {
  const value = ORIGINAL_ENV[key];

  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

describe("Playwright test database guard", () => {
  beforeEach(() => {
    delete process.env.ALLOW_UNSAFE_TEST_DB;
    delete process.env.PLAYWRIGHT_TEST_DATABASE_SELECTED;
    process.env.DATABASE_URL = "postgres://localhost:5432/scouting_platform";
    process.env.DATABASE_URL_TEST =
      "postgres://localhost:5432/scouting_platform_test";
  });

  afterEach(() => {
    restoreEnvValue("ALLOW_UNSAFE_TEST_DB");
    restoreEnvValue("DATABASE_URL");
    restoreEnvValue("DATABASE_URL_TEST");
    restoreEnvValue("PLAYWRIGHT_TEST_DATABASE_SELECTED");
  });

  it("selects and revalidates the dedicated test database idempotently", () => {
    selectSafeTestDatabaseConfiguration();

    expect(process.env.DATABASE_URL).toBe(process.env.DATABASE_URL_TEST);
    expect(() => assertSelectedTestDatabaseConfiguration()).not.toThrow();
    expect(() => selectSafeTestDatabaseConfiguration()).not.toThrow();
  });

  it("refuses an ordinary database as the test target", () => {
    process.env.DATABASE_URL_TEST =
      "postgres://localhost:5432/scouting_platform_staging";

    expect(() => assertSafeTestDatabaseConfiguration()).toThrow(
      "does not look like a dedicated test database",
    );
  });

  it("refuses to start when runtime and test targets are already identical", () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

    expect(() => assertSafeTestDatabaseConfiguration()).toThrow(
      "resolves to the same database",
    );
  });

  it("rejects a selected database that differs from the declared test target", () => {
    process.env.PLAYWRIGHT_TEST_DATABASE_SELECTED = "true";

    expect(() => assertSelectedTestDatabaseConfiguration()).toThrow(
      "instead of postgres://localhost:5432/scouting_platform_test",
    );
  });
});
