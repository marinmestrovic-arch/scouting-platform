import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAdminUser,
  fetchAdminUsers,
  updateAdminUserPassword,
  updateAdminUserYoutubeKey,
} from "./admin-users-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("admin users api helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads users from GET /api/admin/users", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        users: [
          {
            id: "fd4f8967-9f75-4423-a537-6347774dcf1c",
            email: "admin@example.com",
            name: "Admin User",
            role: "admin",
            userType: "admin",
            isActive: true,
            youtubeKeyAssigned: true,
            createdAt: "2026-03-06T10:00:00.000Z",
            updatedAt: "2026-03-06T10:00:00.000Z",
          },
        ],
      }),
    );

    const users = await fetchAdminUsers();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/admin/users",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(users).toEqual([
      expect.objectContaining({
        email: "admin@example.com",
        role: "admin",
      }),
    ]);
  });

  it("returns empty list for empty GET /api/admin/users payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        users: [],
      }),
    );

    const users = await fetchAdminUsers();

    expect(users).toEqual([]);
  });

  it("throws API error messages for failed requests", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "A user with this email already exists",
        },
        409,
      ),
    );

    await expect(
      createAdminUser({
        email: "existing@example.com",
        role: "user",
        userType: "campaign_manager",
        password: "StrongPassword123",
      }),
    ).rejects.toThrow("A user with this email already exists");
  });

  it("creates user via POST /api/admin/users", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: "574d50d5-dfd1-46a8-94cc-8fe2a7396b0c",
        email: "campaign@example.com",
        name: "Campaign User",
        role: "user",
        userType: "campaign_manager",
        isActive: true,
        youtubeKeyAssigned: false,
        createdAt: "2026-03-06T10:00:00.000Z",
        updatedAt: "2026-03-06T10:00:00.000Z",
      }, 201),
    );

    const user = await createAdminUser({
      email: "campaign@example.com",
      name: "Campaign User",
      role: "user",
      userType: "campaign_manager",
      password: "StrongPassword123",
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/admin/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "campaign@example.com",
        name: "Campaign User",
        role: "user",
        userType: "campaign_manager",
        password: "StrongPassword123",
      }),
    });
    expect(user).toEqual(expect.objectContaining({ email: "campaign@example.com" }));
  });

  it("updates user password via PUT /api/admin/users/:id/password", async () => {
    const userId = "574d50d5-dfd1-46a8-94cc-8fe2a7396b0c";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: userId,
        email: "campaign@example.com",
        name: "Campaign User",
        role: "user",
        userType: "campaign_manager",
        isActive: true,
        youtubeKeyAssigned: false,
        createdAt: "2026-03-06T10:00:00.000Z",
        updatedAt: "2026-03-06T10:10:00.000Z",
      }),
    );

    const user = await updateAdminUserPassword(userId, {
      password: "ResetPassword123",
    });

    expect(fetchSpy).toHaveBeenCalledWith(`/api/admin/users/${userId}/password`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        password: "ResetPassword123",
      }),
    });
    expect(user).toEqual(expect.objectContaining({ id: userId }));
  });

  it("throws API error for failed password update", async () => {
    const userId = "574d50d5-dfd1-46a8-94cc-8fe2a7396b0c";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "User not found",
        },
        404,
      ),
    );

    await expect(
      updateAdminUserPassword(userId, {
        password: "ResetPassword123",
      }),
    ).rejects.toThrow("User not found");
  });

  it("updates user YouTube key via PUT /api/admin/users/:id/youtube-key", async () => {
    const userId = "574d50d5-dfd1-46a8-94cc-8fe2a7396b0c";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        ok: true,
      }),
    );

    const result = await updateAdminUserYoutubeKey(userId, {
      youtubeApiKey: "AIzaExampleKey123",
    });

    expect(fetchSpy).toHaveBeenCalledWith(`/api/admin/users/${userId}/youtube-key`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        youtubeApiKey: "AIzaExampleKey123",
      }),
    });
    expect(result).toEqual({ ok: true });
  });

  it("throws authorization error for failed YouTube key update", async () => {
    const userId = "574d50d5-dfd1-46a8-94cc-8fe2a7396b0c";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({}, 403),
    );

    await expect(
      updateAdminUserYoutubeKey(userId, {
        youtubeApiKey: "AIzaExampleKey123",
      }),
    ).rejects.toThrow("You are not authorized to manage users.");
  });

  it("throws route error for failed YouTube key update", async () => {
    const userId = "574d50d5-dfd1-46a8-94cc-8fe2a7396b0c";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        {
          error: "User not found",
        },
        404,
      ),
    );

    await expect(
      updateAdminUserYoutubeKey(userId, {
        youtubeApiKey: "AIzaExampleKey123",
      }),
    ).rejects.toThrow("User not found");
  });
});
