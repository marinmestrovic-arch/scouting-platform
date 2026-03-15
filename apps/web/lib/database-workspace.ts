export const DATABASE_TABS = ["catalog", "runs"] as const;

export type DatabaseTab = (typeof DATABASE_TABS)[number];

function isDatabaseTab(value: string | null): value is DatabaseTab {
  return DATABASE_TABS.some((tab) => tab === value);
}

export function resolveDatabaseTab(
  searchParams: Pick<URLSearchParams, "get">,
): DatabaseTab {
  const requestedTab = searchParams.get("tab");

  if (isDatabaseTab(requestedTab)) {
    return requestedTab;
  }

  if (searchParams.get("runId")) {
    return "runs";
  }

  return "catalog";
}

export function buildDatabaseWorkspaceHref(
  pathname: string,
  searchParams: Pick<URLSearchParams, "entries">,
  next: Readonly<{
    tab: DatabaseTab;
    runId?: string | null;
  }>,
): string {
  const params = new URLSearchParams(Array.from(searchParams.entries()));

  if (next.tab === "runs") {
    params.set("tab", "runs");
  } else {
    params.delete("tab");
  }

  if (next.tab === "runs" && next.runId) {
    params.set("runId", next.runId);
  } else {
    params.delete("runId");
  }

  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}

export function getDatabaseRunHref(runId: string): string {
  const params = new URLSearchParams({
    tab: "runs",
    runId,
  });

  return `/database?${params.toString()}`;
}
