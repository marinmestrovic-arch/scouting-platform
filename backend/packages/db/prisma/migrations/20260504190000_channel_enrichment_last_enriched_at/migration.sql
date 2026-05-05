ALTER TABLE "channel_enrichments"
ADD COLUMN "last_enriched_at" TIMESTAMP(3);

UPDATE "channel_enrichments"
SET "last_enriched_at" = COALESCE("completed_at", "started_at")
WHERE COALESCE("completed_at", "started_at") IS NOT NULL;

CREATE INDEX "channel_enrichments_last_enriched_at_idx"
ON "channel_enrichments"("last_enriched_at");
