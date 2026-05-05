-- This migration is intentionally defensive because some environments may have
-- applied an earlier draft of week-4 enrichment schema changes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'channel_enrichments'
      AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE "channel_enrichments"
    ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'channel_enrichments'
      AND column_name = 'next_retry_at'
  ) THEN
    ALTER TABLE "channel_enrichments"
    ADD COLUMN "next_retry_at" TIMESTAMP(3);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "channel_enrichments_status_requested_at_idx"
ON "channel_enrichments"("status", "requested_at");

CREATE INDEX IF NOT EXISTS "channel_enrichments_status_started_at_idx"
ON "channel_enrichments"("status", "started_at");

CREATE INDEX IF NOT EXISTS "channel_enrichments_status_next_retry_at_idx"
ON "channel_enrichments"("status", "next_retry_at");

CREATE INDEX IF NOT EXISTS "run_results_channel_id_idx"
ON "run_results"("channel_id");
