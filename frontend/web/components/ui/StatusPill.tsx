import type { RunRequestStatus } from "@scouting-platform/contracts";
import React from "react";

import { formatRunStatusLabel } from "../runs/run-presentation";

type StatusPillProps = Readonly<{
  className?: string;
  status: Extract<RunRequestStatus, "queued" | "running" | "completed" | "failed">;
}>;

export function StatusPill({ className, status }: StatusPillProps) {
  return (
    <span className={className ? `status-pill status-pill--${status} ${className}` : `status-pill status-pill--${status}`}>
      <span aria-hidden="true" className="status-pill__dot" />
      <span>{formatRunStatusLabel(status)}</span>
    </span>
  );
}
