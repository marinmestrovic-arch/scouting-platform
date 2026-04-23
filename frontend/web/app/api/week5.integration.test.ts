import { describe, expect, it } from "vitest";

describe("week 5 advanced report route retirement", () => {
  it("returns 410 from POST /api/channels/:id/advanced-report-requests", async () => {
    const route = await import("./channels/[id]/advanced-report-requests/route");

    const response = await route.POST(new Request("http://localhost/api/channels/ignored/advanced-report-requests", {
      method: "POST",
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Advanced report requests are retired from the active product surface.",
    });
  });

  it("returns 410 from GET /api/admin/advanced-report-requests", async () => {
    const route = await import("./admin/advanced-report-requests/route");

    const response = await route.GET(new Request("http://localhost/api/admin/advanced-report-requests"));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Advanced report approvals are retired from the active product surface.",
    });
  });

  it("returns 410 from GET /api/admin/advanced-report-requests/:id", async () => {
    const route = await import("./admin/advanced-report-requests/[id]/route");

    const response = await route.GET(
      new Request("http://localhost/api/admin/advanced-report-requests/ignored"),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Advanced report approvals are retired from the active product surface.",
    });
  });

  it("returns 410 from POST /api/admin/advanced-report-requests/:id/approve", async () => {
    const route = await import("./admin/advanced-report-requests/[id]/approve/route");

    const response = await route.POST(
      new Request("http://localhost/api/admin/advanced-report-requests/ignored/approve", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Advanced report approvals are retired from the active product surface.",
    });
  });

  it("returns 410 from POST /api/admin/advanced-report-requests/:id/reject", async () => {
    const route = await import("./admin/advanced-report-requests/[id]/reject/route");

    const response = await route.POST(
      new Request("http://localhost/api/admin/advanced-report-requests/ignored/reject", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Advanced report approvals are retired from the active product surface.",
    });
  });
});
