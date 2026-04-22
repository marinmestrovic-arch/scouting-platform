import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusPill } from "../StatusPill";
import { StatusTimeline } from "../StatusTimeline";

describe("status primitives", () => {
  it("renders all run status pill variants", () => {
    const queued = renderToStaticMarkup(createElement(StatusPill, { status: "queued" }));
    const running = renderToStaticMarkup(createElement(StatusPill, { status: "running" }));
    const completed = renderToStaticMarkup(createElement(StatusPill, { status: "completed" }));
    const failed = renderToStaticMarkup(createElement(StatusPill, { status: "failed" }));

    expect(queued).toContain("status-pill--queued");
    expect(queued).toContain(">Queued<");
    expect(running).toContain("status-pill--running");
    expect(running).toContain(">Running<");
    expect(completed).toContain("status-pill--completed");
    expect(completed).toContain(">Completed<");
    expect(failed).toContain("status-pill--failed");
    expect(failed).toContain(">Failed<");
  });

  it("renders timeline steps across todo, active, and done states", () => {
    const html = renderToStaticMarkup(
      createElement(StatusTimeline, {
        steps: [
          { key: "queued", label: "Queued", state: "done" },
          { key: "running", label: "Running", state: "active" },
          { key: "completed", label: "Completed", state: "todo" },
        ],
      }),
    );

    expect(html).toContain("timeline__step timeline__step--done");
    expect(html).toContain("timeline__step timeline__step--active");
    expect(html).toContain(">Completed<");
    expect((html.match(/timeline__connector/g) ?? []).length).toBe(2);
  });
});
