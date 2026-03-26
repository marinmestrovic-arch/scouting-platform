import { describe, expect, it } from "vitest";

import {
  buildDatabaseWorkspaceHref,
  getDatabaseRunHref,
  resolveDatabaseTab,
} from "./database-workspace";

describe("database workspace helpers", () => {
  it("defaults to the catalog tab when no explicit run context exists", () => {
    const searchParams = new URLSearchParams();

    expect(resolveDatabaseTab(searchParams)).toBe("catalog");
  });

  it("switches to the runs tab for explicit run context", () => {
    expect(resolveDatabaseTab(new URLSearchParams("tab=runs"))).toBe("runs");
    expect(resolveDatabaseTab(new URLSearchParams("runId=run-1"))).toBe("runs");
  });

  it("preserves catalog filters while switching tabs", () => {
    const href = buildDatabaseWorkspaceHref(
      "/database",
      new URLSearchParams("query=gaming&page=2&enrichmentStatus=completed"),
      {
        tab: "runs",
        runId: "run-1",
      },
    );

    expect(href).toBe(
      "/database?query=gaming&page=2&enrichmentStatus=completed&tab=runs&runId=run-1",
    );
  });

  it("clears run-only params when returning to catalog", () => {
    const href = buildDatabaseWorkspaceHref(
      "/database",
      new URLSearchParams("tab=runs&runId=run-1&query=gaming"),
      {
        tab: "catalog",
      },
    );

    expect(href).toBe("/database?query=gaming");
  });

  it("builds canonical database run detail links", () => {
    expect(getDatabaseRunHref("run 2")).toBe("/runs/run%202");
  });
});
