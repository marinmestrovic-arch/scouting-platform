import type { RunRequestStatus } from "@scouting-platform/contracts";
import React from "react";

import { formatRunStatusLabel } from "../runs/run-presentation";

type StatusPillProps = Readonly<{
  status: Extract<RunRequestStatus, "queued" | "running" | "completed" | "failed">;
}>;

export function StatusPill({ status }: StatusPillProps) {
  return (
    <span className={`status-pill status-pill--${status}`}>
      <span aria-hidden="true" className="status-pill__dot" />
      <span>{formatRunStatusLabel(status)}</span>
    </span>
  );
}
