import process from "node:process";

const DEFAULT_POSTGRES_PORT = "5432";
const TEST_DB_NAME_PATTERN = /(?:^|[_-])test(?:$|[_-])/i;
const ALLOW_UNSAFE_OVERRIDE = "ALLOW_UNSAFE_TEST_DB";

function normalizeProtocol(protocol) {
  const lower = protocol.toLowerCase();

  if (lower === "postgres:" || lower === "postgresql:") {
    return "postgres:";
  }

  return lower;
}

function parseDatabaseUrl(rawValue, envName) {
  const value = rawValue?.trim();

  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[test-db-guard] ${envName} is not a valid URL: ${message}`);
  }
}

function getDatabaseName(url, envName) {
  const databaseName = url.pathname.replace(/^\/+/, "").trim();

  if (!databaseName) {
    throw new Error(`[test-db-guard] ${envName} must include a database name in its path.`);
  }

  return databaseName;
}

function getDatabaseIdentity(url, envName) {
  return {
    protocol: normalizeProtocol(url.protocol),
    hostname: url.hostname.toLowerCase(),
    port: url.port || DEFAULT_POSTGRES_PORT,
    databaseName: getDatabaseName(url, envName).toLowerCase(),
  };
}

function formatIdentity(identity) {
  return `${identity.protocol}//${identity.hostname}:${identity.port}/${identity.databaseName}`;
}

function hasUnsafeBypassFlag() {
  const value = process.env[ALLOW_UNSAFE_OVERRIDE]?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

function buildUnsafeMessage(reason) {
  return [
    `[test-db-guard] ${reason}`,
    `Refusing to continue because this can erase local runtime data.`,
    `Set ${ALLOW_UNSAFE_OVERRIDE}=true only if you intentionally accept the risk.`,
  ].join(" ");
}

export function assertSafeTestDatabaseConfiguration(options = {}) {
  const runtimeUrl = parseDatabaseUrl(options.databaseUrl ?? process.env.DATABASE_URL, "DATABASE_URL");
  const testUrl = parseDatabaseUrl(options.databaseUrlTest ?? process.env.DATABASE_URL_TEST, "DATABASE_URL_TEST");

  if (!testUrl) {
    return;
  }

  if (hasUnsafeBypassFlag()) {
    return;
  }

  const testIdentity = getDatabaseIdentity(testUrl, "DATABASE_URL_TEST");

  if (!TEST_DB_NAME_PATTERN.test(testIdentity.databaseName)) {
    throw new Error(
      buildUnsafeMessage(
        `DATABASE_URL_TEST database name "${testIdentity.databaseName}" does not look like a dedicated test database.`,
      ),
    );
  }

  if (!runtimeUrl) {
    return;
  }

  const runtimeIdentity = getDatabaseIdentity(runtimeUrl, "DATABASE_URL");
  const sameDatabase =
    runtimeIdentity.protocol === testIdentity.protocol
    && runtimeIdentity.hostname === testIdentity.hostname
    && runtimeIdentity.port === testIdentity.port
    && runtimeIdentity.databaseName === testIdentity.databaseName;

  if (sameDatabase) {
    throw new Error(
      buildUnsafeMessage(
        `DATABASE_URL_TEST resolves to the same database as DATABASE_URL (${formatIdentity(testIdentity)}).`,
      ),
    );
  }
}

export function setup() {
  assertSafeTestDatabaseConfiguration();
}

export default setup;
