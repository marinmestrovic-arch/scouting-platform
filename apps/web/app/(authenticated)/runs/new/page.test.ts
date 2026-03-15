import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRunShellMock } = vi.hoisted(() => ({
  createRunShellMock: vi.fn(({ showLegacyNotice }: { showLegacyNotice?: boolean }) =>
    `new-scouting-workspace:${String(showLegacyNotice)}`,
  ),
}));

vi.mock("../../../../components/scouting/new-scouting-workspace", () => ({
  NewScoutingWorkspace: createRunShellMock,
}));

import NewRunPage from "./page";

describe("new run page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the legacy new scouting shortcut", () => {
    const html = renderToStaticMarkup(NewRunPage());

    expect(createRunShellMock.mock.calls[0]?.[0]).toEqual({
      showLegacyNotice: true,
    });
    expect(html).toContain("<h1>New scouting</h1>");
    expect(html).toContain(
      "Legacy shortcut to the new scouting workspace. Only the prompt is live today while the remaining planning controls stay visible as disabled scaffolds.",
    );
    expect(html).toContain("new-scouting-workspace:true");
  });
});
