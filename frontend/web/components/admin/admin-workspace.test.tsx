import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  usePathnameMock,
  useRouterMock,
  useSearchParamsMock,
  replaceMock,
} = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
  useRouterMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useRouter: useRouterMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock("next/link", () => ({
  default: "a",
}));

vi.mock("./admin-advanced-report-queue", () => ({
  AdminAdvancedReportQueue: () => "advanced-report-queue",
}));

vi.mock("./admin-csv-import-manager", () => ({
  AdminCsvImportManager: () => "csv-import-manager",
}));

vi.mock("./admin-users-manager", () => ({
  AdminUsersManager: () => "admin-users-manager",
}));

import { AdminWorkspace } from "./admin-workspace";

describe("admin workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/admin");
    useRouterMock.mockReturnValue({
      replace: replaceMock,
    });
  });

  it("renders the approvals tab without the admin dashboard shell", () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams(""));

    const html = renderToStaticMarkup(createElement(AdminWorkspace));

    expect(html).toContain("Approvals");
    expect(html).toContain("advanced-report-queue");
    expect(html).not.toContain("Admin operations hub");
  });

  it("renders the users manager when the users tab is active", () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("tab=users"));

    const html = renderToStaticMarkup(createElement(AdminWorkspace));

    expect(html).toContain("admin-users-manager");
    expect(html).not.toContain("advanced-report-queue");
  });

  it("keeps the placeholder tabs intact", () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("tab=exports"));

    const html = renderToStaticMarkup(createElement(AdminWorkspace));

    expect(html).toContain("Open exports workspace");
    expect(html).toContain('href="/exports"');
  });
});
