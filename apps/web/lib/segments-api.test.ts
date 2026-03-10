import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSavedSegment,
  deleteSavedSegment,
  fetchSavedSegments,
} from "./segments-api";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("segments api helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads saved segments from GET /api/segments", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "6b9f30d0-8c5f-4ad2-b6fd-1b75928d29d4",
            name: "Space creators",
            filters: {
              query: "space",
              enrichmentStatus: ["completed"],
            },
            createdAt: "2026-03-08T10:00:00.000Z",
            updatedAt: "2026-03-08T10:00:00.000Z",
          },
        ],
      }),
    );

    const response = await fetchSavedSegments();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/segments",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
      }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        name: "Space creators",
      }),
    ]);
  });

  it("creates a saved segment via POST /api/segments", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: "6b9f30d0-8c5f-4ad2-b6fd-1b75928d29d4",
        name: "Space creators",
        filters: {
          query: "space",
          enrichmentStatus: ["completed"],
        },
        createdAt: "2026-03-08T10:00:00.000Z",
        updatedAt: "2026-03-08T10:00:00.000Z",
      }, 201),
    );

    const response = await createSavedSegment({
      name: "Space creators",
      filters: {
        query: "space",
        enrichmentStatus: ["completed"],
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/segments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Space creators",
        filters: {
          query: "space",
          enrichmentStatus: ["completed"],
        },
      }),
    });
    expect(response).toEqual(
      expect.objectContaining({
        name: "Space creators",
      }),
    );
  });

  it("deletes a saved segment via DELETE /api/segments/:id", async () => {
    const segmentId = "6b9f30d0-8c5f-4ad2-b6fd-1b75928d29d4";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteSavedSegment(segmentId);

    expect(fetchSpy).toHaveBeenCalledWith(`/api/segments/${segmentId}`, {
      method: "DELETE",
    });
  });

  it("surfaces authorization failures for segment management routes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(fetchSavedSegments()).rejects.toThrow(
      "You are not authorized to manage saved segments.",
    );
  });

  it("throws when the response shape is invalid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        items: "invalid",
      }),
    );

    await expect(fetchSavedSegments()).rejects.toThrow(
      "Received an invalid saved segments response from the server.",
    );
  });
});
