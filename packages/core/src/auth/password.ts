const PASSWORD_MIN_LENGTH = 8;
type Argon2Module = typeof import("argon2");

let argon2ModulePromise: Promise<Argon2Module> | null = null;

async function loadArgon2(): Promise<Argon2Module> {
  if (!argon2ModulePromise) {
    argon2ModulePromise = import("argon2");
  }

  return argon2ModulePromise;
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
