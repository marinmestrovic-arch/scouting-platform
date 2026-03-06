import { CredentialProvider } from "@prisma/client";

import { prisma, withDbTransaction } from "@scouting-platform/db";

import { ServiceError } from "../errors";
import { decryptSecret, encryptSecret } from "./encryption";

export async function setUserYoutubeApiKey(input: {
  userId: string;
  rawKey: string;
  actorUserId: string;
}): Promise<void> {
  const rawKey = input.rawKey.trim();

  if (!rawKey) {
    throw new ServiceError("INVALID_KEY", 400, "YouTube API key is required");
  }

  const encrypted = encryptSecret(rawKey);

  await withDbTransaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });

    if (!existing) {
      throw new ServiceError("USER_NOT_FOUND", 404, "User not found");
    }

    await tx.userProviderCredential.upsert({
      where: {
        userId_provider: {
          userId: input.userId,
          provider: CredentialProvider.YOUTUBE_DATA_API,
        },
      },
      create: {
        userId: input.userId,
        provider: CredentialProvider.YOUTUBE_DATA_API,
        encryptedSecret: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionAuthTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
      },
      update: {
        encryptedSecret: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionAuthTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "user.youtube_key.updated",
        entityType: "user",
        entityId: input.userId,
      },
    });
  });
}

export async function getUserYoutubeApiKey(userId: string): Promise<string | null> {
  const credential = await prisma.userProviderCredential.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: CredentialProvider.YOUTUBE_DATA_API,
      },
    },
  });

  if (!credential) {
    return null;
  }

  return decryptSecret({
    ciphertext: credential.encryptedSecret,
    iv: credential.encryptionIv,
    authTag: credential.encryptionAuthTag,
    keyVersion: credential.keyVersion,
  });
}

export async function clearUserYoutubeApiKey(input: {
  userId: string;
  actorUserId: string;
}): Promise<void> {
  await withDbTransaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });

    if (!existing) {
      throw new ServiceError("USER_NOT_FOUND", 404, "User not found");
    }

    await tx.userProviderCredential.deleteMany({
      where: {
        userId: input.userId,
        provider: CredentialProvider.YOUTUBE_DATA_API,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "user.youtube_key.cleared",
        entityType: "user",
        entityId: input.userId,
      },
    });
  });
}
