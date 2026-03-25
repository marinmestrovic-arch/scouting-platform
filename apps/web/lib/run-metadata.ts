import type {
  RunCampaignManager,
  RunMetadataResponse,
  RunMonth,
} from "@scouting-platform/contracts";

export const RUN_MONTH_OPTIONS: ReadonlyArray<{ value: RunMonth; label: string }> = [
  { value: "january", label: "January" },
  { value: "february", label: "February" },
  { value: "march", label: "March" },
  { value: "april", label: "April" },
  { value: "may", label: "May" },
  { value: "june", label: "June" },
  { value: "july", label: "July" },
  { value: "august", label: "August" },
  { value: "september", label: "September" },
  { value: "october", label: "October" },
  { value: "november", label: "November" },
  { value: "december", label: "December" },
] as const;

export function formatNullableMetadataValue(
  value: string | number | null | undefined,
  fallback = "—",
): string {
  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return fallback;
}

export function formatCampaignManagerLabel(
  campaignManager: Pick<RunCampaignManager, "name" | "email"> | null,
): string {
  if (!campaignManager) {
    return "—";
  }

  return campaignManager.name?.trim() || campaignManager.email;
}

export function formatRunMonthLabel(month: RunMonth | null | undefined): string {
  if (!month) {
    return "—";
  }

  return RUN_MONTH_OPTIONS.find((option) => option.value === month)?.label ?? month;
}

export function formatRunMonthYear(metadata: Pick<RunMetadataResponse, "month" | "year">): string {
  if (!metadata.month && metadata.year === null) {
    return "—";
  }

  if (!metadata.month) {
    return formatNullableMetadataValue(metadata.year);
  }

  if (metadata.year === null) {
    return formatRunMonthLabel(metadata.month);
  }

  return `${formatRunMonthLabel(metadata.month)} ${metadata.year}`;
}

export function getRunCoveragePercent(resultCount: number, target: number | null): number | null {
  if (target === null || target < 1) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round((resultCount / target) * 100)));
}

export function formatRunCoverageCopy(resultCount: number, target: number | null): string {
  const percent = getRunCoveragePercent(resultCount, target);

  if (percent === null) {
    return `${resultCount} results`;
  }

  return `${percent}% coverage · ${resultCount}/${target}`;
}
