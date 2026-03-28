import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const PASSWORD_MIN_LENGTH = 8;
type Argon2Module = typeof import("argon2");
type RuntimeRequire = (id: string) => unknown;
const ARGON2_MODULE_ID = Buffer.from("YXJnb24y", "base64").toString("utf8");

declare const __non_webpack_require__: RuntimeRequire | undefined;

function getRequireRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), "backend/packages/core/package.json"),
    path.resolve(process.cwd(), "../backend/packages/core/package.json"),
    path.resolve(process.cwd(), "../../backend/packages/core/package.json"),
    path.resolve(process.cwd(), "packages/core/package.json"),
    path.resolve(process.cwd(), "../packages/core/package.json"),
    path.resolve(process.cwd(), "../../packages/core/package.json"),
    path.resolve(process.cwd(), "package.json"),
  ];

  const packageJsonPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!packageJsonPath) {
    throw new Error("Unable to locate a package root for argon2 resolution");
  }

  return packageJsonPath;
}

function getRuntimeRequire(): RuntimeRequire {
  if (typeof __non_webpack_require__ === "function") {
    return __non_webpack_require__;
  }

  return createRequire(getRequireRoot());
}

let argon2Module: Argon2Module | null = null;

async function loadArgon2(): Promise<Argon2Module> {
  if (!argon2Module) {
    argon2Module = getRuntimeRequire()(ARGON2_MODULE_ID) as Argon2Module;
  }

  return argon2Module;
}

function validatePasswordInput(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePasswordInput(password);
  const argon2 = await loadArgon2();

  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) {
    return false;
  }

  const argon2 = await loadArgon2();
  return argon2.verify(hash, password);
}
