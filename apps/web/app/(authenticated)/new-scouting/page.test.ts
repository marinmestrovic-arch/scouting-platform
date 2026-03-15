import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { newScoutingWorkspaceMock } = vi.hoisted(() => ({
  newScoutingWorkspaceMock: vi.fn(() => "new-scouting-workspace"),
}));

vi.mock("../../../components/scouting/new-scouting-workspace", () => ({
  NewScoutingWorkspace: newScoutingWorkspaceMock,
}));

import NewScoutingPage from "./page";

describe("new scouting page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the new scouting workspace", () => {
    const html = renderToStaticMarkup(NewScoutingPage());

    expect(html).toContain("New scouting");
    expect(html).toContain(
      "Start a scouting run with an exact run name and prompt while campaign planning controls stay visible as disabled scaffolds for future backend support.",
    );
    expect(newScoutingWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("new-scouting-workspace");
  });
});
