import { CredentialProvider, type Role as PrismaRole } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

import type { AdminUserResponse, CreateAdminUserRequest } from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";

import { ServiceError } from "../errors";
import { hashPassword } from "./password";
import { fromPrismaRole, toPrismaRole } from "./roles";

type UserWithYoutubeCredential = {
  id: string;
  email: string;
  name: string | null;
  role: PrismaRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  credentials: Array<{ id: string }>;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAdminUserResponse(user: UserWithYoutubeCredential): AdminUserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: fromPrismaRole(user.role),
    isActive: user.isActive,
    youtubeKeyAssigned: user.credentials.length > 0,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

async function getUserWithYoutubeCredential(userId: string): Promise<UserWithYoutubeCredential> {
  return prisma.user.findFirstOrThrow({
    where: { id: userId },
    include: {
      credentials: {
        where: {
          provider: CredentialProvider.YOUTUBE_DATA_API,
        },
        select: {
          id: true,
        },
      },
    },
  });
}

export type CredentialsUserRecord = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "user";
  passwordHash: string;
  isActive: boolean;
};

export async function findUserForCredentials(email: string): Promise<CredentialsUserRecord | null> {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: fromPrismaRole(user.role),
    passwordHash: user.passwordHash,
    isActive: user.isActive,
  };
}

export async function createUser(
  input: CreateAdminUserRequest & { actorUserId: string },
): Promise<AdminUserResponse> {
  const normalizedEmail = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  try {
    const userId = await withDbTransaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: input.name?.trim() || null,
          role: toPrismaRole(input.role),
          passwordHash,
          isActive: true,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: input.actorUserId,
          action: "user.created",
          entityType: "user",
          entityId: user.id,
          metadata: {
            role: input.role,
          },
        },
      });

      return user.id;
    });

    const user = await getUserWithYoutubeCredential(userId);
    return toAdminUserResponse(user);
  } catch (error: unknown) {
    if (error instanceof PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ServiceError("DUPLICATE_EMAIL", 409, "A user with this email already exists");
    }

    throw error;
  }
}

export async function listUsers(): Promise<AdminUserResponse[]> {
  const users = await prisma.user.findMany({
    include: {
      credentials: {
        where: {
          provider: CredentialProvider.YOUTUBE_DATA_API,
        },
        select: {
          id: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return users.map((user) => toAdminUserResponse(user));
}

export async function updateUserPassword(input: {
  userId: string;
  password: string;
  actorUserId: string;
}): Promise<AdminUserResponse> {
  const passwordHash = await hashPassword(input.password);

  await withDbTransaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: {
        id: input.userId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      throw new ServiceError("USER_NOT_FOUND", 404, "User not found");
    }

    await tx.user.update({
      where: {
        id: input.userId,
      },
      data: {
        passwordHash,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "user.password.updated",
        entityType: "user",
        entityId: input.userId,
      },
    });
  });

  const user = await getUserWithYoutubeCredential(input.userId);
  return toAdminUserResponse(user);
}
