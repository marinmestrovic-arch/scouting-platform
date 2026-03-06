export const JOB_NAMES = [
  "runs.discover",
  "runs.recompute",
  "channels.enrich.llm",
  "channels.enrich.hypeauditor",
  "imports.csv.process",
  "exports.csv.generate",
  "hubspot.push.batch",
  "maintenance.refresh-stale",
] as const;

export type JobName = (typeof JOB_NAMES)[number];
