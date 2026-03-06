import { describe, expect, it } from "vitest";

import {
  createAdminUserRequestSchema,
  listChannelsQuerySchema,
} from "./index";

describe("week 1 contracts", () => {
  it("parses valid admin user payload", () => {
    const payload = createAdminUserRequestSchema.parse({
      email: "user@example.com",
      role: "user",
      password: "StrongPassword123",
    });

    expect(payload.email).toBe("user@example.com");
  });

  it("normalizes channel query defaults", () => {
    const payload = listChannelsQuerySchema.parse({});

    expect(payload.page).toBe(1);
    expect(payload.pageSize).toBe(20);
  });
});
