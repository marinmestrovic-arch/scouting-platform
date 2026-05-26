import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { csvExportManagerMock, getSessionMock, redirectMock } = vi.hoisted(() => ({
  csvExportManagerMock: vi.fn(() => "csv-export-manager"),
  getSessionMock: vi.fn(),
  redirectMock: vi.fn((destination: string) => {
    throw new Error(`__redirect__:${destination}`);
  }),
}));

vi.mock("../../../components/exports/csv-export-manager", () => ({
  CsvExportManager: csvExportManagerMock,
}));

vi.mock("../../../lib/cached-auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import ExportsPage from "./page";

describe("exports page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the export manager workspace for admins", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1", role: "admin" } });

    const element = await ExportsPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Exports");
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(csvExportManagerMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("csv-export-manager");
  });

  it("redirects non-admin users to the forbidden route", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u2", role: "user" } });

    await expect(ExportsPage()).rejects.toThrow("__redirect__:/forbidden");
    expect(csvExportManagerMock).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated requests to the login route", async () => {
    getSessionMock.mockResolvedValue(null);

    await expect(ExportsPage()).rejects.toThrow("__redirect__:/login");
    expect(csvExportManagerMock).not.toHaveBeenCalled();
  });
});
