import process from "node:process";

import { assertSafeTestDatabaseConfiguration } from "./test-db-guard.mjs";

const localUrlFlag = "--bootstrap";

function getMode() {
  return process.argv.includes(localUrlFlag) ? "bootstrap" : "runtime";
}

function required(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function requirePostgresUrl(name) {
  const value = required(name);

  if (!value.startsWith("postgresql://") && !value.startsWith("postgres://")) {
    throw new Error(`${name} must be a Postgres connection string`);
  }

  return value;
}

function requireUrl(name) {
  const value = required(name);

  try {
    new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  return value;
}

function requireExactLength(name, length) {
  const value = required(name);

  if (value.length !== length) {
    throw new Error(`${name} must be exactly ${length} characters`);
  }

  return value;
}

function requireMinLength(name, length) {
  const value = required(name);

  if (value.length < length) {
    throw new Error(`${name} must be at least ${length} characters`);
  }

  return value;
}

function requireEmail(name) {
  const value = required(name).toLowerCase();

  if (!value.includes("@")) {
    throw new Error(`${name} must be a valid email address`);
  }

  return value;
}

function validateSharedEnvironment() {
  requirePostgresUrl("DATABASE_URL");
  requireMinLength("AUTH_SECRET", 16);
  requireExactLength("APP_ENCRYPTION_KEY", 32);
  requireUrl("NEXT_PUBLIC_APP_URL");
  const databaseUrlTest = process.env.DATABASE_URL_TEST?.trim();

  if (databaseUrlTest) {
    requirePostgresUrl("DATABASE_URL_TEST");
    assertSafeTestDatabaseConfiguration();
  }
}

function validateBootstrapEnvironment() {
  validateSharedEnvironment();
  requirePostgresUrl("DATABASE_URL_TEST");
  assertSafeTestDatabaseConfiguration();
  requireEmail("INITIAL_ADMIN_EMAIL");
  requireMinLength("INITIAL_ADMIN_PASSWORD", 8);
  required("INITIAL_ADMIN_NAME");
}

try {
  if (getMode() === "bootstrap") {
    validateBootstrapEnvironment();
  } else {
    validateSharedEnvironment();
  }

  process.stdout.write("[env] local environment is valid\n");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[env] ${message}\n`);
  process.exit(1);
}
