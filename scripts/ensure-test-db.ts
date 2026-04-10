import process from "node:process";

import { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "@scouting-platform/db";

function parseDatabaseName(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace(/^\//, "");

  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name");
  }

  return databaseName;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const databaseUrlTest = process.env.DATABASE_URL_TEST?.trim();

  if (!databaseUrl || !databaseUrlTest) {
    throw new Error("DATABASE_URL and DATABASE_URL_TEST are required");
  }

  const testDatabaseName = parseDatabaseName(databaseUrlTest);
  const escapedTestDatabaseName = testDatabaseName.replace(/'/g, "''");
  const quotedTestDatabaseName = testDatabaseName.replace(/"/g, "\"\"");
  const prisma = createPrismaClient({ databaseUrl });

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = '${escapedTestDatabaseName}') AS "exists"`,
    );

    if (rows[0]?.exists) {
      process.stdout.write(`Test database already exists: ${testDatabaseName}\n`);
      return;
    }

    await prisma.$executeRawUnsafe(`CREATE DATABASE "${quotedTestDatabaseName}"`);
    process.stdout.write(`Created test database: ${testDatabaseName}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to ensure test database: ${message}\n`);
  process.exit(1);
});
