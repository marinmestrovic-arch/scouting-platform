import process from "node:process";

import { disconnectPrisma } from "../backend/packages/db/src";
import { setUserYoutubeApiKey } from "../backend/packages/core/src/auth/credentials";
import { seedInitialAdmin } from "../backend/packages/core/src/auth/seed-admin";

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

function optionalEnv(name: string): string | null {
  return process.env[name]?.trim() || null;
}

async function main(): Promise<void> {
  const email = normalizeEmail(requiredEnv("INITIAL_ADMIN_EMAIL"));
  const password = requiredEnv("INITIAL_ADMIN_PASSWORD");
  const name = process.env.INITIAL_ADMIN_NAME?.trim() || "Initial Admin";
  const youtubeApiKey = optionalEnv("INITIAL_ADMIN_YOUTUBE_API_KEY") ?? optionalEnv("YOUTUBE_API_KEY");

  if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error(
      "INITIAL_ADMIN_PASSWORD must be at least 12 characters and include at least one letter and one number",
    );
  }

  try {
    const user = await seedInitialAdmin({
      email,
      password,
      name,
    });

    process.stdout.write(`Seeded admin user: ${user.email}\n`);

    if (youtubeApiKey) {
      await setUserYoutubeApiKey({
        userId: user.id,
        rawKey: youtubeApiKey,
        actorUserId: user.id,
      });
      process.stdout.write(`Seeded YouTube API key for admin user: ${user.email}\n`);
    }
  } finally {
    await disconnectPrisma();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to seed admin user: ${message}\n`);
  process.exit(1);
});
