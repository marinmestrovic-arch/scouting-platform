ALTER TABLE "channel_enrichments"
ADD COLUMN "last_enriched_at" TIMESTAMP(3),
ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "next_retry_at" TIMESTAMP(3);

UPDATE "channel_enrichments"
SET "last_enriched_at" = COALESCE("completed_at", "started_at")
WHERE COALESCE("completed_at", "started_at") IS NOT NULL;

CREATE INDEX "channel_enrichments_last_enriched_at_idx"
ON "channel_enrichments"("last_enriched_at");

CREATE INDEX "channel_enrichments_status_requested_at_idx"
ON "channel_enrichments"("status", "requested_at");

CREATE INDEX "channel_enrichments_status_started_at_idx"
ON "channel_enrichments"("status", "started_at");

CREATE INDEX "channel_enrichments_status_next_retry_at_idx"
ON "channel_enrichments"("status", "next_retry_at");

CREATE INDEX "run_results_channel_id_idx"
ON "run_results"("channel_id");
