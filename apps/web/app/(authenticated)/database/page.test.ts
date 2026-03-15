import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { databaseWorkspaceMock } = vi.hoisted(() => ({
  databaseWorkspaceMock: vi.fn(() => "database-workspace"),
}));

vi.mock("../../../components/database/database-workspace", () => ({
  DatabaseWorkspace: databaseWorkspaceMock,
}));

import DatabasePage from "./page";

describe("database page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the database workspace", () => {
    const html = renderToStaticMarkup(DatabasePage());

    expect(html).toContain("Database");
    expect(html).toContain(
      "Use one workspace for run snapshots and the canonical creator catalog, with export and HubSpot actions available where the shortlist is reviewed.",
    );
    expect(databaseWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("database-workspace");
  });
});
