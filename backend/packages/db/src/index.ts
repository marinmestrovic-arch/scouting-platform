import process from "node:process";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

type GlobalWithPrisma = typeof globalThis & {
  __scoutingPrisma?: PrismaClient;
  __scoutingPrismaSchemaFingerprint?: string;
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

function getPrismaSchemaFingerprint(): string {
  return Prisma.dmmf.datamodel.models
    .map((model) => model.name)
    .sort()
    .join("|");
}

function getPrismaModelDelegateName(modelName: string): string {
  return `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;
}

function clientSupportsCurrentModels(prismaClient: PrismaClient): boolean {
  return Prisma.dmmf.datamodel.models.every((model) =>
    Reflect.get(prismaClient as object, getPrismaModelDelegateName(model.name)) !== undefined,
  );
}

function getOrCreatePrismaClient(): PrismaClient {
  const cachedPrisma = globalForPrisma.__scoutingPrisma;
  const schemaFingerprint = getPrismaSchemaFingerprint();

  if (
    cachedPrisma
    && (
      globalForPrisma.__scoutingPrismaSchemaFingerprint === schemaFingerprint
      || (
        globalForPrisma.__scoutingPrismaSchemaFingerprint === undefined
        && clientSupportsCurrentModels(cachedPrisma)
      )
    )
  ) {
    globalForPrisma.__scoutingPrismaSchemaFingerprint = schemaFingerprint;
    return cachedPrisma;
  }

  const prismaClient = createPrismaClient();

  globalForPrisma.__scoutingPrisma = prismaClient;
  globalForPrisma.__scoutingPrismaSchemaFingerprint = schemaFingerprint;

  // Prisma generation can add delegates while a development server remains alive.
  // Replace that stale global client instead of returning undefined model delegates.
  if (cachedPrisma) {
    void cachedPrisma.$disconnect().catch(() => undefined);
  }

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
    delete globalForPrisma.__scoutingPrismaSchemaFingerprint;
  }
}
