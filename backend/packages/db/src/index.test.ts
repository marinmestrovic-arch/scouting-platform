import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(async () => {
  const testGlobal = globalThis as typeof globalThis & {
    __scoutingPrisma?: { $disconnect(): Promise<void> };
    __scoutingPrismaSchemaFingerprint?: string;
  };
  await testGlobal.__scoutingPrisma?.$disconnect();
  delete testGlobal.__scoutingPrisma;
  delete testGlobal.__scoutingPrismaSchemaFingerprint;
  process.env.DATABASE_URL = originalDatabaseUrl;
  vi.resetModules();
});

describe("createPrismaClient", () => {
  it("fails fast when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;

    const { createPrismaClient } = await import("./index");

    expect(() => createPrismaClient()).toThrow("DATABASE_URL is required to create a Prisma client");
  });

  it("creates a Prisma client when DATABASE_URL is provided", async () => {
    process.env.DATABASE_URL =
      "postgresql://scouting:scouting@localhost:5432/scouting_platform?schema=public";

    const { createPrismaClient } = await import("./index");
    const prisma = createPrismaClient();

    await expect(prisma.$disconnect()).resolves.toBeUndefined();
  });
});

describe("prisma singleton", () => {
  it("does not throw on import before DATABASE_URL is configured", async () => {
    delete process.env.DATABASE_URL;

    await expect(import("./index")).resolves.toBeDefined();
  });

  it("fails on first use when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;

    const { prisma } = await import("./index");

    expect(() => prisma.$disconnect()).toThrow("DATABASE_URL is required to create a Prisma client");
  });

  it("replaces a stale development singleton that is missing generated model delegates", async () => {
    process.env.DATABASE_URL =
      "postgresql://scouting:scouting@localhost:5432/scouting_platform?schema=public";
    const staleDisconnect = vi.fn().mockResolvedValue(undefined);
    const testGlobal = globalThis as typeof globalThis & {
      __scoutingPrisma?: unknown;
      __scoutingPrismaSchemaFingerprint?: string;
    };
    testGlobal.__scoutingPrisma = { $disconnect: staleDisconnect };
    delete testGlobal.__scoutingPrismaSchemaFingerprint;

    const { prisma } = await import("./index");

    expect(prisma.hubspotDealMirror).toBeDefined();
    expect(staleDisconnect).toHaveBeenCalledOnce();
  });
});
