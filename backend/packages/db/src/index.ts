import process from "node:process";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

type GlobalWithPrisma = typeof globalThis & {
  __scoutingPrisma?: PrismaClient;
};

export type DbTransactionClient = Prisma.TransactionClient;
export type CreatePrismaClientOptions = {
  databaseUrl?: string;
};
export type DbTransactionOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
};

function getDatabaseUrl({ databaseUrl }: CreatePrismaClientOptions): string | undefined {
  const resolvedDatabaseUrl = databaseUrl ?? process.env.DATABASE_URL;
  const trimmedDatabaseUrl = resolvedDatabaseUrl?.trim();

  return trimmedDatabaseUrl ? trimmedDatabaseUrl : undefined;
}

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const databaseUrl = getDatabaseUrl(options);

  if (databaseUrl) {
    return new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
      }),
    });
  }

  return new PrismaClient();
}

const globalForPrisma = globalThis as GlobalWithPrisma;

export const prisma = globalForPrisma.__scoutingPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__scoutingPrisma = prisma;
}

export async function withDbTransaction<T>(
  callback: (tx: DbTransactionClient) => Promise<T>,
  options?: DbTransactionOptions,
): Promise<T> {
  return prisma.$transaction((tx) => callback(tx), options);
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export async function resetPrismaClientForTests(): Promise<void> {
  const cachedPrisma = globalForPrisma.__scoutingPrisma;

  if (cachedPrisma) {
    await cachedPrisma.$disconnect();
    delete globalForPrisma.__scoutingPrisma;
  }
}
