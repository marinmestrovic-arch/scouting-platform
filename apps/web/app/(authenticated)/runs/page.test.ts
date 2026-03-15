import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { databaseWorkspaceMock } = vi.hoisted(() => ({
  databaseWorkspaceMock: vi.fn(({ forcedTab, showLegacyNotice }: { forcedTab?: string; showLegacyNotice?: boolean }) =>
    `database-workspace:${String(forcedTab)}:${String(showLegacyNotice)}`,
  ),
}));

vi.mock("../../../components/database/database-workspace", () => ({
  DatabaseWorkspace: databaseWorkspaceMock,
}));

import RunsPage from "./page";

describe("runs page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the legacy runs shortcut into the database workspace", () => {
    const html = renderToStaticMarkup(RunsPage());

    expect(html).toContain("Runs");
    expect(html).toContain(
      "Legacy shortcut to the Database runs tab. Review stored run snapshots and launch CSV or HubSpot actions from the consolidated database workspace.",
    );
    expect(databaseWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(databaseWorkspaceMock.mock.calls[0]?.[0]).toEqual({
      forcedTab: "runs",
      showLegacyNotice: true,
    });
    expect(html).toContain("database-workspace:runs:true");
  });
});
