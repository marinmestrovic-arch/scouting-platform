CREATE TYPE "channel_youtube_refresh_status" AS ENUM ('idle', 'queued', 'running', 'completed', 'failed');

ALTER TABLE "channel_youtube_contexts"
ADD COLUMN "refresh_status" "channel_youtube_refresh_status" NOT NULL DEFAULT 'idle',
ADD COLUMN "refresh_requested_at" TIMESTAMP(3),
ADD COLUMN "refresh_started_at" TIMESTAMP(3),
ADD COLUMN "refresh_completed_at" TIMESTAMP(3),
ADD COLUMN "refresh_retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "refresh_next_retry_at" TIMESTAMP(3);

CREATE INDEX "channel_youtube_contexts_refresh_status_requested_at_idx"
ON "channel_youtube_contexts"("refresh_status", "refresh_requested_at");

CREATE INDEX "channel_youtube_contexts_refresh_status_started_at_idx"
ON "channel_youtube_contexts"("refresh_status", "refresh_started_at");

CREATE INDEX "channel_youtube_contexts_refresh_status_next_retry_at_idx"
ON "channel_youtube_contexts"("refresh_status", "refresh_next_retry_at");
