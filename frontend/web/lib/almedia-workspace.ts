const ALMEDIA_TABS = [
  "insights",
  "bookings",
  "performance",
  "scorecard",
  "invoices",
] as const;

export type AlmediaTab = (typeof ALMEDIA_TABS)[number];

export const ALMEDIA_TAB_LABELS = {
  insights: "Insights",
  bookings: "Bookings",
  performance: "Performance",
  scorecard: "Scorecard",
  invoices: "Invoices",
} as const satisfies Record<AlmediaTab, string>;

function isAlmediaTab(value: string | null): value is AlmediaTab {
  return ALMEDIA_TABS.some((tab) => tab === value);
}

export function resolveAlmediaTab(
  searchParams: Pick<URLSearchParams, "get">,
): AlmediaTab {
  const requestedTab = searchParams.get("tab");

  return isAlmediaTab(requestedTab) ? requestedTab : "insights";
}

export function buildAlmediaWorkspaceHref(
  pathname: string,
  searchParams: Pick<URLSearchParams, "entries">,
  next: Readonly<{ tab: AlmediaTab }>,
): string {
  const params = new URLSearchParams(Array.from(searchParams.entries()));

  // Insights is the default, so it stays out of the URL.
  if (next.tab === "insights") {
    params.delete("tab");
  } else {
    params.set("tab", next.tab);
  }

  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Sync failures are persisted by the worker for diagnostics. Older rows can
 * contain an Error stack, so never render that database value verbatim in the
 * browser. Give admins an actionable message without leaking internal paths.
 */
export function formatAlmediaSyncFailure(lastError: string): string {
  if (lastError.includes("ALMEDIA_API_KEY")) {
    return "Almedia sync is not configured on the worker. Set ALMEDIA_API_KEY, then retry.";
  }

  return "Almedia sync could not refresh. Existing data is still available; retry or check the worker logs.";
}

export const ALMEDIA_TABS_IN_ORDER: readonly AlmediaTab[] = ALMEDIA_TABS;
