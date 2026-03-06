import process from "node:process";

import { PrismaClient, Role } from "@prisma/client";
import argon2 from "argon2";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function main(): Promise<void> {
  const email = normalizeEmail(requiredEnv("INITIAL_ADMIN_EMAIL"));
  const password = requiredEnv("INITIAL_ADMIN_PASSWORD");
  const name = process.env.INITIAL_ADMIN_NAME?.trim() || "Initial Admin";

  if (password.length < 8) {
    throw new Error("INITIAL_ADMIN_PASSWORD must be at least 8 characters");
  }

  const prisma = new PrismaClient();
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  try {
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name,
        role: Role.ADMIN,
        passwordHash,
        isActive: true,
      },
      update: {
        name,
        role: Role.ADMIN,
        passwordHash,
        isActive: true,
      },
    });

    await prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        action: "system.admin_seeded",
        entityType: "user",
        entityId: user.id,
        metadata: {
          email: user.email,
        },
      },
    });

    process.stdout.write(`Seeded admin user: ${user.email}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to seed admin user: ${message}\n`);
  process.exit(1);
});
