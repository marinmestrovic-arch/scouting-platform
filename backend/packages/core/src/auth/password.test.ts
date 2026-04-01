import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

const originalCwd = process.cwd();

function resolveFrontendWebDirectory(): string {
  const candidates = [
    path.resolve(originalCwd, "frontend", "web"),
    path.resolve(originalCwd, "..", "..", "..", "frontend", "web"),
    path.resolve(originalCwd, "..", "..", "frontend", "web"),
  ];

  const match = candidates.find((candidate) => fs.existsSync(candidate));

  if (!match) {
    throw new Error("Unable to locate frontend/web for cwd-independence test");
  }

  return match;
}

describe("password hashing", () => {
  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("SuperSecurePass123");

    await expect(verifyPassword("SuperSecurePass123", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("resolves argon2 independently of the current working directory", async () => {
    process.chdir(resolveFrontendWebDirectory());

    const hash = await hashPassword("DirectoryIndependentPass123");

    await expect(verifyPassword("DirectoryIndependentPass123", hash)).resolves.toBe(true);
  });

  it("rejects short passwords", async () => {
    await expect(hashPassword("short")).rejects.toThrow("at least 8 characters");
  });
});
