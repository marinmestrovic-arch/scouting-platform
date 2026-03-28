import process from "node:process";

const PLAYWRIGHT_TEST_ENCRYPTION_KEY = "01234567890123456789012345678901";
const ENCRYPTION_KEY_BYTE_LENGTH = 32;

function hasValidEncryptionKey(value: string | undefined): boolean {
  if (!value || value.trim().length === 0) {
    return false;
  }

  return Buffer.from(value, "utf8").length === ENCRYPTION_KEY_BYTE_LENGTH;
}

export function ensurePlaywrightEnvironment(): void {
  if (!hasValidEncryptionKey(process.env.APP_ENCRYPTION_KEY)) {
    process.env.APP_ENCRYPTION_KEY = PLAYWRIGHT_TEST_ENCRYPTION_KEY;
  }
}
