import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, usePathnameMock, useRouterMock, useSearchParamsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  usePathnameMock: vi.fn(),
  useRouterMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useRouter: useRouterMock,
  useSearchParams: useSearchParamsMock,
}));

const { catalogTableShellMock, databaseRunsTabMock } = vi.hoisted(() => ({
  catalogTableShellMock: vi.fn(() => "catalog-table-shell"),
  databaseRunsTabMock: vi.fn(({ requestedRunId }: { requestedRunId: string | null }) =>
    `database-runs-tab:${String(requestedRunId)}`,
  ),
}));

vi.mock("../catalog/catalog-table-shell", () => ({
  CatalogTableShell: catalogTableShellMock,
}));

vi.mock("./database-runs-tab", () => ({
  DatabaseRunsTab: databaseRunsTabMock,
}));

import { DatabaseWorkspace } from "./database-workspace";

function findButtonByLabel(node: ReactNode, label: string): ReactElement<{ onClick: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findButtonByLabel(child, label);

      if (match) {
        return match;
      }
    }

    return null;
  }

  if (!isValidElement(node)) {
    return null;
  }

  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  const text = typeof element.props.children === "string" ? element.props.children : null;

  if (element.type === "button" && text === label) {
    return element as ReactElement<{ onClick: () => void }>;
  }

  return findButtonByLabel(element.props.children, label);
}

describe("database workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/database");
    useRouterMock.mockReturnValue({
      push: pushMock,
    });
  });

  it("renders the catalog tab by default", () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams());

    const html = renderToStaticMarkup(createElement(DatabaseWorkspace));

    expect(html).not.toContain("Catalog view");
    expect(html).not.toContain("Canonical catalog");
    expect(html).not.toContain("Available today");
    expect(catalogTableShellMock).toHaveBeenCalledTimes(1);
    expect(databaseRunsTabMock).not.toHaveBeenCalled();
  });

  it("renders the runs tab for explicit run context", () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("tab=runs&runId=run-1"));

    const html = renderToStaticMarkup(createElement(DatabaseWorkspace));

    expect(databaseRunsTabMock).toHaveBeenCalledWith({
      onSelectRun: expect.any(Function),
      requestedRunId: "run-1",
    }, undefined);
    expect(html).toContain("database-runs-tab:run-1");
  });

  it("pushes a new url when switching tabs", () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("query=gaming"));

    const element = DatabaseWorkspace({});
    const runsButton = findButtonByLabel(element, "Runs");

    runsButton?.props.onClick();

    expect(pushMock).toHaveBeenCalledWith("/database?query=gaming&tab=runs");
  });
});
