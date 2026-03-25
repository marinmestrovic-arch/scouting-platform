import { Role, UserType } from "@prisma/client";
import { prisma } from "@scouting-platform/db";

import { hashPassword } from "./password";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function seedInitialAdmin(input: {
  email: string;
  password: string;
  name?: string | null;
}): Promise<{ id: string; email: string; name: string | null }> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const name = input.name?.trim() || "Initial Admin";

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name,
      role: Role.ADMIN,
      userType: UserType.ADMIN,
      passwordHash,
      isActive: true,
    },
    update: {
      name,
      role: Role.ADMIN,
      userType: UserType.ADMIN,
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

  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}
