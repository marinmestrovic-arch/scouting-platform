import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "./encryption";

const TEST_KEY = "12345678901234567890123456789012";

describe("youtube key encryption", () => {
  it("round-trips encrypted payload", () => {
    const payload = encryptSecret("yt-api-key", { key: TEST_KEY, keyVersion: 3 });
    const decrypted = decryptSecret(payload, { key: TEST_KEY });

    expect(payload.keyVersion).toBe(3);
    expect(decrypted).toBe("yt-api-key");
  });

  it("rejects invalid key length", () => {
    expect(() => encryptSecret("abc", { key: "too-short" })).toThrow(
      "APP_ENCRYPTION_KEY must be exactly 32 bytes",
    );
  });
});
