ALTER TABLE "advanced_report_requests"
  ADD COLUMN "provider_fetched_at"      TIMESTAMP(3),
  ADD COLUMN "last_provider_attempt_at" TIMESTAMP(3),
  ADD COLUMN "next_provider_attempt_at" TIMESTAMP(3);

ALTER TABLE "channel_enrichments"
  ADD COLUMN "raw_openai_payload_fetched_at" TIMESTAMP(3),
  ADD COLUMN "youtube_fetched_at"            TIMESTAMP(3);
