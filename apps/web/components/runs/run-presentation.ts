import type { RunRequestStatus } from "@scouting-platform/contracts";

type RunFailureInfo = {
  lastError: string | null;
};

type RunPresentationInfo = RunFailureInfo & {
  resultCount: number;
  status: RunRequestStatus;
};

export type RunJobFeedback = {
  autoRefresh: boolean;
  nextStep: string;
  summary: string;
  title: string;
  tone: "info" | "success" | "error";
};

export const RUN_STATUS_POLL_INTERVAL_MS = 3000;

export function shouldPollRunStatus(status: RunRequestStatus): boolean {
  return status === "queued" || status === "running";
}

export function formatRunStatusLabel(status: RunRequestStatus): string {
  if (status === "queued") {
    return "Queued";
  }

  if (status === "running") {
    return "Running";
  }

  if (status === "completed") {
    return "Completed";
  }

  return "Failed";
}

export function formatRunTimestamp(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);

  if (!match) {
    return value;
  }

  return `${match[1]} ${match[2]} UTC`;
}

export function formatRunResultCount(resultCount: number): string {
  if (resultCount === 1) {
    return "1 result";
  }

  return `${resultCount} results`;
}

export function getRunFailureMessage(run: RunFailureInfo): string {
  if (!run.lastError) {
    return "The run failed before the worker could finish processing it.";
  }

  if (run.lastError.includes("quota exceeded")) {
    return "YouTube API quota was exhausted before discovery completed. Retry later or ask an admin to rotate the assigned key.";
  }

  if (run.lastError.includes("YouTube API key")) {
    return "This account needs an assigned YouTube API key before the worker can run discovery.";
  }

  return run.lastError;
}

export function getRunStatusSummary(run: RunPresentationInfo): string {
  if (run.status === "queued") {
    return "Waiting for the discovery worker.";
  }

  if (run.status === "running") {
    return "Discovery worker is processing this run.";
  }

  if (run.status === "completed") {
    if (run.resultCount === 0) {
      return "Snapshot complete with no saved matches.";
    }

    return "Snapshot complete and ready for review.";
  }

  return "Run needs attention before you try again.";
}

export function getRunJobFeedback(run: RunPresentationInfo): RunJobFeedback {
  if (run.status === "queued") {
    return {
      autoRefresh: true,
      nextStep: "No results are expected yet. Leave this view open or check back shortly.",
      summary:
        "The worker has not claimed this run yet. Status refreshes automatically while it remains in the queue.",
      title: "Discovery job queued",
      tone: "info",
    };
  }

  if (run.status === "running") {
    return {
      autoRefresh: true,
      nextStep:
        "This view refreshes automatically. An empty results list is normal until ranked snapshot rows are written.",
      summary:
        "The worker is searching catalog matches and YouTube discoveries with the assigned API key.",
      title: "Discovery job running",
      tone: "info",
    };
  }

  if (run.status === "completed") {
    if (run.resultCount === 0) {
      return {
        autoRefresh: false,
        nextStep: "Try a broader query or rerun later if you expect fresh discoveries.",
        summary: "The worker finished and stored an empty snapshot for this query.",
        title: "Discovery job completed",
        tone: "success",
      };
    }

    return {
      autoRefresh: false,
      nextStep:
        "Open any catalog detail to review that channel's enrichment status or request a fresh enrichment run.",
      summary:
        "The worker finished and locked this snapshot so it stays reproducible during review.",
      title: "Discovery job completed",
      tone: "success",
    };
  }

  return {
    autoRefresh: false,
    nextStep:
      "Fix the underlying issue, then start a new run. Refresh once more only if you expect a late worker update.",
    summary: getRunFailureMessage(run),
    title: "Discovery job failed",
    tone: "error",
  };
}

export function getRunResultsEmptyMessage(run: RunPresentationInfo): string {
  if (run.status === "queued") {
    return "No snapshot rows have been stored yet. That is expected while the discovery job is still queued.";
  }

  if (run.status === "running") {
    return "Results have not been written yet. Keep this page open while the worker continues processing.";
  }

  if (run.status === "completed") {
    return "Discovery completed without saving matching channels in the snapshot.";
  }

  return "No snapshot results were stored because the discovery job failed.";
}
