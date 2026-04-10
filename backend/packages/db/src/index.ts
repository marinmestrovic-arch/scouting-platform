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

function getDatabaseUrl({ databaseUrl }: CreatePrismaClientOptions): string {
  const resolvedDatabaseUrl = databaseUrl ?? process.env.DATABASE_URL;
  const trimmedDatabaseUrl = resolvedDatabaseUrl?.trim();

  if (!trimmedDatabaseUrl) {
    throw new Error("DATABASE_URL is required to create a Prisma client");
  }

  return trimmedDatabaseUrl;
}

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const databaseUrl = getDatabaseUrl(options);

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
    }),
  });
}

const globalForPrisma = globalThis as GlobalWithPrisma;

function getOrCreatePrismaClient(): PrismaClient {
  const cachedPrisma = globalForPrisma.__scoutingPrisma;

  if (cachedPrisma) {
    return cachedPrisma;
  }

  const prismaClient = createPrismaClient();

  globalForPrisma.__scoutingPrisma = prismaClient;

  return prismaClient;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const prismaClient = getOrCreatePrismaClient();
    const value = Reflect.get(prismaClient as object, property, receiver);

    return typeof value === "function" ? value.bind(prismaClient) : value;
  },
}) as PrismaClient;

export async function withDbTransaction<T>(
  callback: (tx: DbTransactionClient) => Promise<T>,
  options?: DbTransactionOptions,
): Promise<T> {
  return prisma.$transaction((tx) => callback(tx), options);
}

export async function disconnectPrisma(): Promise<void> {
  const cachedPrisma = globalForPrisma.__scoutingPrisma;

  if (!cachedPrisma) {
    return;
  }

  await cachedPrisma.$disconnect();
}

export async function resetPrismaClientForTests(): Promise<void> {
  const cachedPrisma = globalForPrisma.__scoutingPrisma;

  if (cachedPrisma) {
    await cachedPrisma.$disconnect();
    delete globalForPrisma.__scoutingPrisma;
  }
}
