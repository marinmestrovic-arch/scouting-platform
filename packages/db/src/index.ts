import process from "node:process";

import { Prisma, PrismaClient } from "@prisma/client";

type GlobalWithPrisma = typeof globalThis & {
  __scoutingPrisma?: PrismaClient;
};

export type DbTransactionClient = Prisma.TransactionClient;
export type DbTransactionOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
};

export function createPrismaClient(): PrismaClient {
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
