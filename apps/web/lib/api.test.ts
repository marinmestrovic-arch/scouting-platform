import { ServiceError } from "@scouting-platform/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth", () => ({
  auth: vi.fn(),
}));

import { toRouteErrorResponse } from "./api";

describe("api route error mapping", () => {
  it("returns service errors with original message and status", async () => {
    const response = toRouteErrorResponse(new ServiceError("CHANNEL_NOT_FOUND", 404, "Not found"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
  });

  it("hides unknown error details behind a generic 500 response", async () => {
    const response = toRouteErrorResponse(new Error("database connection string leaked"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
    });
  });

  it("hides non-Error thrown values behind a generic 500 response", async () => {
    const response = toRouteErrorResponse("unexpected string throw");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
    });
  });
});
