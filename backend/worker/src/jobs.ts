export const JOB_NAMES = [
  "runs.discover",
  "runs.recompute",
  "runs.assess.channel-fit",
  "channels.enrich.llm",
  "channels.enrich.hypeauditor",
  "imports.csv.process",
  "exports.csv.generate",
  "hubspot.import.batch",
  "hubspot.push.batch",
  "maintenance.refresh-stale",
] as const;

export type JobName = (typeof JOB_NAMES)[number];
