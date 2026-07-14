import process from "node:process";

import { repairChannelCountries } from "../backend/packages/core/src";
import { disconnectPrisma, prisma } from "../backend/packages/db/src";

function getFlagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new Error("--limit must be an integer between 1 and 1000");
  }

  return parsed;
}

async function main(): Promise<void> {
  const adminEmail = getFlagValue("admin-email")?.trim().toLowerCase();
  const limit = parseLimit(getFlagValue("limit"));
  const afterId = getFlagValue("after-id")?.trim();

  if (!adminEmail) {
    throw new Error("--admin-email is required");
  }

  const admin = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true },
  });

  if (!admin) {
    throw new Error(`Admin user not found: ${adminEmail}`);
  }

  const result = await repairChannelCountries({
    requestedByUserId: admin.id,
    apply: hasFlag("apply"),
    clearUnverified: hasFlag("clear-unverified"),
    ...(limit !== undefined ? { limit } : {}),
    ...(afterId ? { afterId } : {}),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
